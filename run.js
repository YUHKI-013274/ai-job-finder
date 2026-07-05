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
const { loadSeenJobs, saveSeenJobs, loadAppliedJobs } = require('./store');
const { syncAppliedFromSheet } = require('./sheet-sync');
const { MIN_RAW_JOBS } = require('./config');

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
  const rawJobs = await scrapeJobs();

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

  console.log('\n案件を評価・分類中...');
  const { candidates, holds, excluded } = classifyJobs(rawJobs, appliedMap, seenMap);

  if (candidates.length < 5) {
    console.log(`⚠️  応募候補が5件未満です（${candidates.length}件）。SEARCH_KEYWORDSを増やすことを検討してください。`);
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

  console.log(`応募候補 ${candidates.length}件 / 保留 ${holds.length}件 / 除外 ${excluded.length}件`);
  console.log('除外内訳:', JSON.stringify(excludeReasonCounts));
  console.log(`(新規に既出登録: ${newlySeenCount}件)`);

  // 4. HTML / Markdown 出力
  const htmlContent = renderHTML({ candidates, holds, excluded }, now, PAGE_URL);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.html`), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.html'), htmlContent, 'utf8');

  const mdContent = renderMarkdown({ candidates, holds, excluded }, now);
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
      const msg = `📋 案件更新 ${dateLabel} (候補:${candidates.length} 保留:${holds.length} 除外:${excluded.length})`;
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
    await sendGmailNotification({ jobs: candidates, pageUrl: PAGE_URL, date: now });
  } else {
    console.log('\n💡 Gmail通知をスキップ（環境変数未設定）');
    console.log('   .env ファイルに GMAIL_USER と GMAIL_APP_PASSWORD を設定してください');
  }

  console.log(`\n✅ 完了！`);
  console.log(`スマホURL: ${PAGE_URL}`);
}

function pushToGhPages(outputDir, repoDir, commitMsg) {
  try {
    // リモートの最新状態を取得してローカルのgh-pages参照を合わせる
    // （GitHub Actions側のデプロイと競合してpushが拒否されるのを防ぐ）
    execSync('git fetch origin gh-pages', { cwd: repoDir, stdio: 'pipe' });
    execSync('git branch -f gh-pages origin/gh-pages', { cwd: repoDir, stdio: 'pipe' });

    // worktreeを使ってgh-pagesへデプロイ
    const worktreeDir = path.join(repoDir, '.gh-pages-worktree');
    if (fs.existsSync(worktreeDir)) {
      execSync(`git worktree remove "${worktreeDir}" --force`, { cwd: repoDir, stdio: 'pipe' });
    }
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
    execSync(`git worktree remove "${worktreeDir}" --force`, { cwd: repoDir, stdio: 'pipe' });
    console.log('✅ GitHub Pages (gh-pages) へデプロイ完了');
  } catch (err) {
    console.log(`⚠️  gh-pages push失敗: ${err.message}`);
  }
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
