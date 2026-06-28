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
const { rankAndSelect } = require('./evaluator');
const { renderHTML, renderMarkdown } = require('./renderer');
const { sendGmailNotification } = require('./notifier');
const { MAX_JOBS } = require('./config');

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

  console.log('=== AI案件獲得システム Ver2.0 ===');
  console.log(`実行日時: ${now.toLocaleString('ja-JP')}`);
  console.log(`公開URL: ${PAGE_URL}\n`);

  // 1. スクレイピング
  const rawJobs = await scrapeJobs();

  if (rawJobs.length === 0) {
    console.log('\n⚠️  案件を取得できませんでした。ネット接続を確認してください。');
    process.exit(1);
  }

  // 2. 評価・ランキング
  console.log('\n案件を評価・ランキング中...');
  const selected = rankAndSelect(rawJobs, MAX_JOBS);
  const sCount = selected.filter(j => j.rank === 'S').length;
  const aCount = selected.filter(j => j.rank === 'A').length;
  console.log(`${selected.length}件選定 (S:${sCount} A:${aCount})`);

  // 3. HTML / Markdown 出力
  const htmlContent = renderHTML(selected, now, PAGE_URL);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.html`), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.html'), htmlContent, 'utf8');

  const mdContent = renderMarkdown(selected, now);
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

  // 4. 結果サマリー
  console.log('\n=== 選定結果 ===');
  selected.forEach((job, i) => {
    const mark = i < 3 ? '🎯' : '  ';
    console.log(`${mark} ${i + 1}. [${job.rank}] ${job.title.substring(0, 45)}...`);
    console.log(`      ${job.url}`);
  });

  // 5. GitHub Pages へ push（PC実行時のみ）
  if (!IS_CI) {
    console.log('\nGitHub Pages へ push 中...');
    try {
      const repoDir = __dirname;
      execSync('git add output/', { cwd: repoDir, stdio: 'inherit' });

      // gh-pages ブランチへ直接コミット&プッシュ
      const msg = `📋 案件更新 ${dateLabel} (S:${sCount} A:${aCount})`;
      execSync(`git commit -m "${msg}" --allow-empty`, { cwd: repoDir, stdio: 'inherit' });
      execSync('git push origin master', { cwd: repoDir, stdio: 'inherit' });
      console.log('✅ masterへpush完了');

      // gh-pagesブランチにoutputの内容をデプロイ
      pushToGhPages(outputDir, repoDir, msg);
    } catch (err) {
      console.log(`⚠️  push失敗: ${err.message}`);
    }
  }

  // 6. Gmail 通知
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || '';
  if (gmailUser && gmailPass) {
    console.log('\nGmail通知を送信中...');
    await sendGmailNotification({ jobs: selected, pageUrl: PAGE_URL, date: now });
  } else {
    console.log('\n💡 Gmail通知をスキップ（環境変数未設定）');
    console.log('   .env ファイルに GMAIL_USER と GMAIL_APP_PASSWORD を設定してください');
  }

  console.log(`\n✅ 完了！`);
  console.log(`スマホURL: ${PAGE_URL}`);
}

function pushToGhPages(outputDir, repoDir, commitMsg) {
  try {
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
