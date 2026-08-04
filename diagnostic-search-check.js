// GitHub Actions環境でCrowdWorks検索結果が0件になる直接原因を切り分けるための、
// 一時的な診断専用スクリプト。scraper.jsの抽出ロジック・selector・返り値には一切触れない。
// 出力は診断ログ(標準出力)のみ。ファイル書き込み・Git操作・通知は行わない。
// レスポンスHTML全文・個人情報は出力しない。
const { chromium } = require('playwright');

const SEARCH_URL = 'https://crowdworks.jp/public/jobs/search';
const KEYWORD = 'ライティング';
const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
};

const SUSPICIOUS_PATTERNS = [
  { label: 'CAPTCHA', re: /captcha|recaptcha|ロボットではありません/i },
  { label: 'ログイン要求', re: /ログインしてください|ログインが必要|sign in required/i },
  { label: 'アクセス拒否/制限', re: /access denied|forbidden|アクセスが拒否|アクセスを制限|一時的に利用できません|アクセスが集中/i },
  { label: 'Cloudflare等の検証ページ', re: /just a moment|checking your browser|cloudflare/i },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();

  const url = `${SEARCH_URL}?keyword=${encodeURIComponent(KEYWORD)}&order=new&page=1`;
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (err) {
    console.log('=== 診断結果 ===');
    console.log('goto失敗:', err.message.split('\n')[0]);
    await browser.close();
    process.exit(0);
  }

  await page.waitForSelector('[data-testid="job-offer-card"], .job_offer_detail, article', { timeout: 15000 }).catch(() => null);

  const title = await page.title();
  const bodyHtmlLength = await page.evaluate(() => document.body.outerHTML.length);
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  const candidateLinkCount = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/public/jobs/"]');
    return [...links].filter(a => /\/public\/jobs\/\d+/.test(a.href)).length;
  });

  const matchedSignals = SUSPICIOUS_PATTERNS.filter(p => p.re.test(bodyText)).map(p => p.label);

  console.log('=== 診断結果 ===');
  console.log('リクエストURL:', url);
  console.log('HTTPステータス:', response ? response.status() : '(レスポンスなし)');
  console.log('最終URL:', page.url());
  console.log('ページタイトル:', title);
  console.log('HTML本文文字数(body要素のouterHTML文字数):', bodyHtmlLength);
  console.log('案件リンク候補数:', candidateLinkCount);
  console.log('CAPTCHA/ログイン/アクセス拒否等の兆候:', matchedSignals.length > 0 ? matchedSignals.join(', ') : 'なし');

  await browser.close();
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
