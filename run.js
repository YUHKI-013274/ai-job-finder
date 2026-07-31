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
const { sendGmailNotification } = require('./notifier');
const { loadSeenJobs, saveSeenJobs, loadAppliedJobs, loadJobStatus, filterJobStatus, JOB_STATUS } = require('./store');
const { syncAppliedFromSheet } = require('./sheet-sync');
const { MIN_RAW_JOBS, CURRENT_PHASE, CURRENT_PHASE_KEY } = require('./config');

const IS_CI = process.env.CI === 'true';
const REPO_OWNER = 'YUHKI-013274';
const REPO_NAME = 'ai-job-finder';
const PAGE_URL = process.env.PAGES_URL
  || `https://${REPO_OWNER}.github.io/${REPO_NAME}/`;

async function main() {
  const now = new Date();
  const dateLabel = now.toISOString().slice(0, 10);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  console.log('=== AI案件獲得システム Ver3.0 ===');
  console.log(`実行日時: ${now.toLocaleString('ja-JP')}`);
  console.log(`公開URL: ${PAGE_URL}\n`);

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
  const { candidates, growthCandidates, holds, excluded } = classifyJobs(rawJobs, appliedMap, seenMap, rejectedMap);

  if (candidates.length < 5) {
    console.log(`ℹ️  今日の応募候補は${candidates.length}件です（S・Aランクのみ。無理な枠埋めはしていません）`);
  }

  // 3. 既出リストを更新（今回取得した全案件を記録し、翌回以降は重複表示しない）
  let newlySeenCount = 0;
  for (const job of rawJobs) {
    if (!seenMap[job.id]) {
      seenMap[job.id] = { firstSeen: dateLabel, title: job.title, url: job.url };
      newlySeenCount++;
    }
  }
  saveSeenJobs(seenMap);

  const excludeReasonCounts = excluded.reduce((acc, j) => {
    acc[j.excludeReason] = (acc[j.excludeReason] || 0) + 1;
    return acc;
  }, {});

  console.log(`応募候補 ${candidates.length}件 / 成長候補 ${growthCandidates.length}件 / 保留 ${holds.length}件 / 除外 ${excluded.length}件`);
  console.log('除外内訳:', JSON.stringify(excludeReasonCounts));
  console.log(`(新規に既出登録: ${newlySeenCount}件)`);

  // キーワード別内訳（取得件数・新規/重複・S/A/B/C/除外への振り分け結果）
  // 注意：job.matchedKeyword はevaluator.js側で表示用に「実際に一致した業務内容の代表語」へ
  // 上書きされるため、検索キーワード別の内訳には使えない。scraper.jsが保持する
  // matchedKeywords（検索語の配列、上書きされない）を使って集計する。
  const rankByKeyword = {};
  for (const job of [...candidates, ...growthCandidates, ...holds, ...excluded]) {
    const keywords = (job.matchedKeywords && job.matchedKeywords.length > 0) ? job.matchedKeywords : [job.matchedKeyword || '(不明)'];
    for (const kw of keywords) {
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

  // 4. HTML / Markdown 出力
  const htmlContent = renderHTML({ candidates, growthCandidates, holds, excluded }, now, PAGE_URL);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.html`), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.html'), htmlContent, 'utf8');

  const mdContent = renderMarkdown({ candidates, growthCandidates, holds, excluded }, now);
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
  console.log('\n=== 応募候補 ===');
  candidates.forEach((job, i) => {
    const mark = i < 3 ? '🎯' : '  ';
    console.log(`${mark} ${i + 1}. [${job.rank}] ${job.title.substring(0, 45)}...`);
    console.log(`      ${job.url}`);
  });

  // 6. GitHub Pages へ push（PC実行時のみ）
  if (!IS_CI) {
    console.log('\nGitHub Pages へ push 中...');
    try {
      const repoDir = __dirname;
      const sCount = candidates.filter(j => j.rank === 'S').length;
      const aCount = candidates.filter(j => j.rank === 'A').length;
      execSync('git add output/ data/', { cwd: repoDir, stdio: 'inherit' });

      // gh-pages ブランチへ直接コミット&プッシュ
      const msg = `📋 案件更新 ${dateLabel} (候補:${candidates.length} 成長候補:${growthCandidates.length} 保留:${holds.length} 除外:${excluded.length})`;
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
    await sendGmailNotification({ jobs: candidates, growthCount: growthCandidates.length, pageUrl: PAGE_URL, date: now });
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

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
