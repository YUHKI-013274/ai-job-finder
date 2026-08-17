const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// .env ファイルを手動読み込み（dotenv不要）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}
const { scrapeJobs } = require('./scraper');
const { classifyJobs } = require('./evaluator');
const { renderHTML, renderMarkdown } = require('./renderer');
const { sendGmailNotification, sendSystemAlert } = require('./notifier');
const { ensureBrowserAvailable } = require('./browser-check');
const { loadSeenJobs, saveSeenJobs, loadAppliedJobs, loadJobStatus, filterJobStatus, JOB_STATUS, updateJobHistoryEntry } = require('./store');
const { syncAppliedFromSheet } = require('./sheet-sync');
const { MIN_RAW_JOBS, CURRENT_PHASE, CURRENT_PHASE_KEY } = require('./config');
const detailScraper = require('./detail-scraper');
const detailStore = require('./detail-store');
const analyzer = require('./analyzer');
const aiAnalyzer = require('./ai-analyzer');

// ブラウザが1ページでクラッシュした後、Playwright内部の非同期処理（再接続試行等）が
// 少し遅れてrejectし、呼び出し元のtry/catchで捕まえられないままプロセス全体を
// 落とすことがある。個別キーワードのエラーは既にログ済みのため、ここで握りつぶして
// スクレイピングループを継続させる。
process.on('unhandledRejection', (err) => {
  console.log(`⚠️  未処理のPromiseエラー（無視して続行）: ${err && err.message ? err.message.split('\n')[0] : err}`);
});

const IS_CI = process.env.CI === 'true';
const REPO_OWNER = 'YUHKI-013274';
const REPO_NAME = 'ai-job-finder';
const PAGE_URL = process.env.PAGES_URL
  || `https://${REPO_OWNER}.github.io/${REPO_NAME}/`;

// Stage0（詳細取得）→Stage1（ルールベース分析・外部API不要）→Stage2（AI分析・Anthropic APIが
// 正常な場合のみ）をこの順で接続する。各段は独立して失敗を許容し、案件取得・出力・通知・デプロイという
// 既存の本番フローを止めない。Stage2の成否はStage1が確定させたランキング・除外判定・分析結果
// （別ファイルに保存済み）を一切変更しない。
async function runAnalysisPipeline(classified) {
  console.log('\n=== 案件分析パイプライン（Stage0→Stage1→Stage2） ===');

  // Stage0: 優先候補（今すぐ応募→高単価チャレンジ→通常チャレンジ→確認候補）の詳細取得
  let validDetails = [];
  try {
    const candidatePool = detailScraper.selectCandidatesForDetailFetch(classified, detailScraper.DETAIL_FETCH_MAX_ATTEMPTS);
    const stage0Result = await detailScraper.fetchJobDetailsWithBackfill(candidatePool);
    validDetails = stage0Result.validDetails;
    detailStore.saveJobDetails(validDetails);
    console.log(`Stage0: 詳細取得 ${stage0Result.stats.validCount}件（試行${stage0Result.stats.attemptedCandidateCount}件中）`);
  } catch (err) {
    console.log(`⚠️  Stage0スキップ（詳細取得に失敗）: ${err.message}`);
  }

  // Stage1: ルールベース分析（外部API不要のため、Anthropicの状態に関わらず必ず実行を試みる）
  try {
    const stage1Results = analyzer.analyzeAllPendingJobDetails();
    const analyzedCount = stage1Results.filter(r => r.analyzed).length;
    console.log(`Stage1: 分析完了 ${analyzedCount}件（対象外${stage1Results.length - analyzedCount}件）`);
  } catch (err) {
    console.log(`⚠️  Stage1スキップ（分析処理に失敗）: ${err.message}`);
  }

  // Stage2: AI分析（Anthropic APIが正常な場合のみ実行。401/429/5xx・キー未設定・その他例外の
  // いずれが起きてもここで吸収し、Stage1までの結果（別ファイル保存済み）を変更せず後続処理を継続する）。
  try {
    // Stage0の優先順位（今すぐ応募が先頭）をそのまま踏襲し、先頭3件のみ対象にする
    // （費用管理のための固定件数。ai-analyzer.js自体が「3件固定で呼び出す想定」として設計済み）。
    const stage2Candidates = validDetails.map(d => d.jobId).slice(0, 3);

    if (stage2Candidates.length === 0) {
      console.log('Stage2: 対象案件なし（スキップ）');
    } else {
      const stage2Summary = await aiAnalyzer.runStage2ForJobIds(stage2Candidates);
      const successCount = stage2Summary.results.filter(r => r.outcome === 'success').length;
      const failedCount = stage2Summary.results.filter(r => r.outcome === 'failed').length;
      const skippedCount = stage2Summary.results.filter(r => r.outcome === 'skipped').length;
      console.log(`Stage2: 成功${successCount}件 / 失敗${failedCount}件 / スキップ${skippedCount}件（費用$${stage2Summary.cumulativeCostUsd.toFixed(4)}）`);
    }
  } catch (err) {
    console.log(`💡 Stage2スキップ（AI分析を利用できないため、Stage1までの結果で継続）: ${err.message}`);
  }
}

async function main() {
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  console.log('=== AI案件獲得システム Ver3.0 ===');
  console.log(`実行日時: ${now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`公開URL: ${PAGE_URL}\n`);

  // 0. Playwrightブラウザの起動確認（不足時は自動復旧を試み、それでも失敗したら
  //    案件取得を試みる前に異常通知を送って明示的に停止する。無言で失敗させない）。
  const browserCheck = await ensureBrowserAvailable();
  if (!browserCheck.ok) {
    console.log(`\n❌ Playwrightブラウザが利用できないため案件取得を中止しました: ${browserCheck.error}`);
    try {
      await sendSystemAlert({
        title: 'Playwrightブラウザ起動失敗（案件取得を中止しました）',
        message: `自動復旧を試みましたが失敗しました。\n\n${browserCheck.error}\n\nPCで以下を手動実行して復旧してください:\nnpx playwright install chromium`,
      });
    } catch (alertErr) {
      console.log(`⚠️  異常通知メールの送信にも失敗しました: ${alertErr.message}`);
    }
    process.exit(1);
  }
  if (browserCheck.recovered) {
    console.log('（Playwrightブラウザを自動復旧してから続行します）\n');
  }

  // 1. スクレイピング
  const { jobs: rawJobs, keywordStats } = await scrapeJobs();

  if (rawJobs.length === 0) {
    console.log('\n⚠️  案件を取得できませんでした。ネット接続を確認してください。');
    process.exit(1);
  }
  if (rawJobs.length < MIN_RAW_JOBS) {
    console.log(`\n⚠️  取得件数が目標(${MIN_RAW_JOBS}件)を下回っています（${rawJobs.length}件）。キーワードを増やすか時間をおいて再実行してください。`);
  }

  // 2. 案件管理シートから応募済みを同期 → 既出・応募済みチェック → 評価・分類
  if (process.env.APPLIED_SHEET_URL) {
    const syncResult = await syncAppliedFromSheet(process.env.APPLIED_SHEET_URL);
    if (syncResult.synced > 0) {
      console.log(`案件管理シートから応募済み${syncResult.synced}件を新規同期しました`);
    }
  }
  const seenMap = loadSeenJobs();
  const appliedMap = loadAppliedJobs();
  const rejectedMap = filterJobStatus(loadJobStatus(), JOB_STATUS.SKIPPED);

  console.log(`\nフェーズ: ${CURRENT_PHASE_KEY}（${CURRENT_PHASE.label}）`);
  console.log('案件を評価・分類中...');
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded, allEvaluated } = classifyJobs(rawJobs, appliedMap, seenMap, rejectedMap);

  if (nowApply.length < 5) {
    console.log(`ℹ️  今日の「今すぐ応募」案件は${nowApply.length}件です（無理な枠埋めはしていません）`);
  }

  // 3. 案件履歴を更新（seen_jobs.jsonは除外リストではなく履歴として使う）。
  // 今回評価した全案件（allEvaluated＝新着＋継続候補＋除外）の最終確認日・表示区分・
  // 最終表示日を記録する。「一度取得した」ことは翌回以降の除外理由にはならない。
  const shownIds = new Set([
    ...nowApply.map(j => j.id),
    ...highValueChallenge.map(j => j.id),
    ...normalChallenge.map(j => j.id),
    ...confirmCandidates.map(j => j.id),
  ]);
  let newlySeenCount = 0;
  let continuingCount = 0;
  for (const job of allEvaluated) {
    const isNew = !seenMap[job.id];
    if (isNew) newlySeenCount++; else continuingCount++;
    seenMap[job.id] = updateJobHistoryEntry(seenMap[job.id], {
      job, dateLabel, wasShown: shownIds.has(job.id),
    });
  }
  saveSeenJobs(seenMap);

  const excludeReasonCounts = excluded.reduce((acc, j) => {
    acc[j.excludeReason] = (acc[j.excludeReason] || 0) + 1;
    return acc;
  }, {});

  console.log(`今すぐ応募 ${nowApply.length}件 / 高単価チャレンジ ${highValueChallenge.length}件 / 通常チャレンジ ${normalChallenge.length}件 / 確認候補 ${confirmCandidates.length}件 / 保留 ${holds.length}件 / 除外 ${excluded.length}件`);
  console.log('除外内訳:', JSON.stringify(excludeReasonCounts));
  console.log(`(新着: ${newlySeenCount}件 / 継続候補: ${continuingCount}件)`);
  const candidateJobs = [...nowApply, ...highValueChallenge, ...normalChallenge, ...confirmCandidates];
  const newInCandidates = candidateJobs.filter(j => j.jobStatus === '新着').length;
  const continuingInCandidates = candidateJobs.filter(j => j.jobStatus === '継続候補').length;
  console.log(`(応募検討候補の内訳: 新着${newInCandidates}件 / 継続候補${continuingInCandidates}件)`);

  // キーワード・カテゴリ別内訳（取得件数・新規/重複・S/A/B/C/除外への振り分け結果）
  // 注意1：job.matchedKeyword はevaluator.js側で表示用に「実際に一致した業務内容の代表語」へ
  // 上書きされるため、検索キーワード別の内訳には使えない。scraper.jsが保持する
  // matchedKeywords／matchedCategories（上書きされない配列）を使って集計する。
  // 注意2：nowApply/highValueChallenge/normalChallenge/holdsは表示件数の上限で切り詰め済みのため、
  // 集計には切り詰め前の全件を保持するallEvaluatedを使う（表示は従来通りcapped版を使用）。
  const rankByKeyword = {};
  for (const job of allEvaluated) {
    const sources = [];
    if (job.matchedKeywords && job.matchedKeywords.length > 0) sources.push(...job.matchedKeywords);
    if (job.matchedCategories && job.matchedCategories.length > 0) {
      sources.push(...job.matchedCategories.map(c => `[カテゴリ] ${c}`));
    }
    if (sources.length === 0) sources.push(job.matchedKeyword || '(不明)');

    for (const kw of sources) {
      if (!rankByKeyword[kw]) rankByKeyword[kw] = { S: 0, A: 0, B: 0, C: 0, 除外: 0 };
      if (job.excluded) rankByKeyword[kw]['除外']++;
      else if (job.rank) rankByKeyword[kw][job.rank]++;
    }
  }
  console.log('\n=== キーワード別内訳 ===');
  for (const stat of keywordStats) {
    const r = rankByKeyword[stat.keyword] || { S: 0, A: 0, B: 0, C: 0, 除外: 0 };
    if (stat.error) {
      console.log(`  ${stat.keyword}: エラー（${stat.error}）`);
      continue;
    }
    console.log(`  ${stat.keyword}: 取得${stat.found}件 新規${stat.newCount}件 重複${stat.dupCount}件 → S:${r.S} A:${r.A} B:${r.B} C:${r.C} 除外:${r['除外']}`);
  }

  // 3.5. 案件分析パイプライン（Stage0→Stage1→Stage2）。失敗しても以降の出力・通知・デプロイは止めない。
  await runAnalysisPipeline({ nowApply, highValueChallenge, normalChallenge, confirmCandidates });

  // 4. HTML / Markdown 出力
  const htmlContent = renderHTML({ nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded }, now, PAGE_URL);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.html`), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.html'), htmlContent, 'utf8');

  const mdContent = renderMarkdown({ nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded }, now);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.md`), mdContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.md'), mdContent, 'utf8');

  // manifest.json（PWA）
  const manifest = {
    name: 'AI案件チェッカー',
    short_name: 'AI案件',
    description: '毎朝クラウドワークスのAI案件を確認',
    start_url: './',
    display: 'standalone',
    background_color: '#1a1a2e',
    theme_color: '#1a1a2e',
  };
  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  // 5. 結果サマリー
  console.log('\n=== 今すぐ応募 ===');
  nowApply.forEach((job, i) => {
    const mark = i < 3 ? '🎯' : '  ';
    console.log(`${mark} ${i + 1}. [${job.rank}] ${job.title.substring(0, 45)}...`);
    console.log(`      ${job.url}`);
  });

  // 6. GitHub Pages へ push（PC実行時のみ）
  if (!IS_CI) {
    console.log('\nGitHub Pages へ push 中...');
    try {
      const repoDir = __dirname;
      execSync('git add output/ data/', { cwd: repoDir, stdio: 'inherit' });

      // gh-pages ブランチへ直接コミット&プッシュ
      const msg = `📋 案件更新 ${dateLabel} (今すぐ応募:${nowApply.length} 高単価チャレンジ:${highValueChallenge.length} 通常チャレンジ:${normalChallenge.length} 確認候補:${confirmCandidates.length} 保留:${holds.length} 除外:${excluded.length})`;
      execSync(`git commit -m "${msg}" --allow-empty`, { cwd: repoDir, stdio: 'inherit' });
      execSync('git push origin master', { cwd: repoDir, stdio: 'inherit' });
      console.log('✅ masterへpush完了');

      // gh-pagesブランチにoutputの内容をデプロイ
      pushToGhPages(outputDir, repoDir, msg);
    } catch (err) {
      console.log(`⚠️  push失敗: ${err.message}`);
    }
  }

  // 7. Gmail 通知（応募候補ベース）
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || '';
  if (gmailUser && gmailPass) {
    console.log('\nGmail通知を送信中...');
    await sendGmailNotification({ jobs: nowApply, growthCount: highValueChallenge.length + normalChallenge.length, pageUrl: PAGE_URL, date: now });
  } else {
    console.log('\n💡 Gmail通知をスキップ（環境変数未設定）');
    console.log('   .env ファイルに GMAIL_USER と GMAIL_APP_PASSWORD を設定してください');
  }

  console.log(`\n✅ 完了！`);
  console.log(`スマホURL: ${PAGE_URL}`);
}

function pushToGhPages(outputDir, repoDir, commitMsg) {
  const worktreeDir = path.join(repoDir, '.gh-pages-worktree');

  // 前回の失敗などでworktreeが残っていると、以降の全処理が失敗するため必ず先に片付ける
  try {
    execSync(`git worktree remove "${worktreeDir}" --force`, { cwd: repoDir, stdio: 'pipe' });
  } catch {
    // 登録が無い場合は何もしない
  }
  try {
    execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
  } catch {
    // 無視
  }
  if (fs.existsSync(worktreeDir)) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }

  try {
    // リモートの最新状態を取得してローカルのgh-pages参照を合わせる
    // （GitHub Actions側のデプロイと競合してpushが拒否されるのを防ぐ）
    execSync('git fetch origin gh-pages', { cwd: repoDir, stdio: 'pipe' });
    execSync('git branch -f gh-pages origin/gh-pages', { cwd: repoDir, stdio: 'pipe' });

    // worktreeを使ってgh-pagesへデプロイ
    execSync(`git worktree add "${worktreeDir}" gh-pages`, { cwd: repoDir, stdio: 'pipe' });

    // outputの内容をworktreeにコピー
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      fs.copyFileSync(
        path.join(outputDir, file),
        path.join(worktreeDir, file)
      );
    }

    execSync('git add -A', { cwd: worktreeDir, stdio: 'pipe' });
    execSync(`git commit -m "${commitMsg}" --allow-empty`, { cwd: worktreeDir, stdio: 'pipe' });
    execSync('git push origin gh-pages', { cwd: worktreeDir, stdio: 'inherit' });
    console.log('✅ GitHub Pages (gh-pages) へデプロイ完了');
  } catch (err) {
    console.log(`⚠️  gh-pages push失敗: ${err.message}`);
  } finally {
    // 成功・失敗にかかわらずworktreeは必ず片付け、次回実行に影響を残さない
    try {
      execSync(`git worktree remove "${worktreeDir}" --force`, { cwd: repoDir, stdio: 'pipe' });
    } catch {
      // 無視
    }
  }
}

module.exports = { runAnalysisPipeline };

// requireされた場合（テスト等）はmain()を自動実行しない。`node run.js`で直接実行された場合のみ動く。
if (require.main === module) {
  main().catch(err => {
    console.error('エラー:', err.message);
    process.exit(1);
  });
}
