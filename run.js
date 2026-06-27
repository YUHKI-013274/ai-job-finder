const fs = require('fs');
const path = require('path');
const { scrapeJobs } = require('./scraper');
const { rankAndSelect } = require('./evaluator');
const { renderHTML, renderMarkdown } = require('./renderer');
const { sendGmailNotification } = require('./notifier');
const { MAX_JOBS } = require('./config');

// GitHub Pages URL（環境変数またはデフォルト）
const PAGE_URL = process.env.PAGES_URL || 'http://localhost/output/latest.html';

async function main() {
  const now = new Date();
  const dateLabel = now.toISOString().slice(0, 10);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  console.log('=== AI案件獲得システム Ver2.0 ===');
  console.log(`実行日時: ${now.toLocaleString('ja-JP')}\n`);

  // 1. スクレイピング
  const rawJobs = await scrapeJobs();

  if (rawJobs.length === 0) {
    console.log('\n⚠️  案件を取得できませんでした。');
    process.exit(1);
  }

  // 2. 評価・ランキング
  console.log('\n案件を評価・ランキング中...');
  const selected = rankAndSelect(rawJobs, MAX_JOBS);
  const sCount = selected.filter(j => j.rank === 'S').length;
  const aCount = selected.filter(j => j.rank === 'A').length;
  console.log(`${selected.length}件選定 (S:${sCount} A:${aCount})`);

  // 3. HTML出力
  const htmlContent = renderHTML(selected, now, PAGE_URL);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.html`), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.html'), htmlContent, 'utf8');

  // 4. Markdown出力
  const mdContent = renderMarkdown(selected, now);
  fs.writeFileSync(path.join(outputDir, `jobs_${dateLabel}.md`), mdContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'latest.md'), mdContent, 'utf8');

  // 5. manifest.json（PWA用）
  const manifest = {
    name: 'AI案件チェッカー',
    short_name: 'AI案件',
    description: '毎朝クラウドワークスのAI案件を確認',
    start_url: '.',
    display: 'standalone',
    background_color: '#1a1a2e',
    theme_color: '#1a1a2e',
    icons: [{ src: 'icon.png', sizes: '192x192', type: 'image/png' }],
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 6. 結果サマリー
  console.log('\n=== 選定結果 ===');
  selected.forEach((job, i) => {
    const mark = i < 3 ? '🎯' : '  ';
    console.log(`${mark} ${i + 1}. [${job.rank}] ${job.title.substring(0, 45)}...`);
    console.log(`      ${job.url}`);
  });

  // 7. Gmail通知
  if (process.env.GMAIL_USER) {
    console.log('\nGmail通知を送信中...');
    await sendGmailNotification({ jobs: selected, pageUrl: PAGE_URL, date: now });
  }

  console.log(`\n✅ 完了`);
  console.log(`HTML: ${path.join(outputDir, 'index.html')}`);
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
