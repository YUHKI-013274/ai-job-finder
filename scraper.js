const { chromium } = require('playwright');
const { SEARCH_KEYWORDS, SEARCH_DELAY_MS } = require('./config');

const BASE_URL = 'https://crowdworks.jp';
const SEARCH_URL = `${BASE_URL}/public/jobs/search`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeJobs() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const allJobs = [];
  const seenIds = new Set();

  console.log('クラウドワークス案件を取得中...');

  for (const keyword of SEARCH_KEYWORDS) {
    process.stdout.write(`  検索: "${keyword}" ... `);
    const page = await context.newPage();

    try {
      const url = `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}&order=new`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // ジョブリストが読み込まれるまで待機
      await page.waitForSelector('[data-testid="job-offer-card"], .job_offer_detail, article', {
        timeout: 15000
      }).catch(() => null);

      const jobs = await page.evaluate((baseUrl) => {
        const results = [];

        // 複数のセレクターパターンを試す
        const selectors = [
          '[data-testid="job-offer-card"]',
          '.job_offer_detail',
          'article[class*="job"]',
          '.offer_detail',
          '[class*="JobOfferCard"]',
          '[class*="job-offer"]',
        ];

        let cards = [];
        for (const sel of selectors) {
          cards = document.querySelectorAll(sel);
          if (cards.length > 0) break;
        }

        // セレクターで取得できない場合、リンクから案件URLを抽出
        if (cards.length === 0) {
          const links = document.querySelectorAll('a[href*="/public/jobs/"]');
          const jobLinks = [...links].filter(a => /\/public\/jobs\/\d+/.test(a.href));

          jobLinks.forEach(link => {
            const idMatch = link.href.match(/\/public\/jobs\/(\d+)/);
            if (!idMatch) return;

            const title = link.textContent.trim() || link.querySelector('[class*="title"], h2, h3')?.textContent.trim() || '';
            if (!title || title.length < 5) return;

            const card = link.closest('li, article, div[class*="card"], div[class*="offer"]') || link;
            const text = card.textContent;

            // 報酬を抽出
            const priceMatch = text.match(/([¥￥][\d,]+(?:〜[\d,]+)?(?:万円)?|[\d,]+円(?:〜[\d,]+円)?)/);
            const price = priceMatch ? priceMatch[1] : '要確認';

            // 応募人数を抽出
            const appMatch = text.match(/(\d+)\s*人が応募/);
            const applicants = appMatch ? parseInt(appMatch[1]) : null;

            results.push({
              id: idMatch[1],
              title,
              url: `${baseUrl}/public/jobs/${idMatch[1]}`,
              price,
              applicants,
              deadline: null,
              description: text.substring(0, 200),
            });
          });

          return results;
        }

        cards.forEach(card => {
          const linkEl = card.querySelector('a[href*="/public/jobs/"]');
          if (!linkEl) return;

          const idMatch = linkEl.href.match(/\/public\/jobs\/(\d+)/);
          if (!idMatch) return;

          const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="name"]');
          const title = titleEl?.textContent.trim() || linkEl.textContent.trim() || '';
          if (!title || title.length < 5) return;

          const text = card.textContent;

          const priceMatch = text.match(/([¥￥][\d,]+(?:〜[\d,]+)?(?:万円)?|[\d,]+円(?:〜[\d,]+円)?)/);
          const price = priceMatch ? priceMatch[1] : '要確認';

          const appMatch = text.match(/(\d+)\s*人が応募/);
          const applicants = appMatch ? parseInt(appMatch[1]) : null;

          const deadlineMatch = text.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}月\d{1,2}日)/);
          const deadline = deadlineMatch ? deadlineMatch[1] : null;

          results.push({
            id: idMatch[1],
            title,
            url: `${baseUrl}/public/jobs/${idMatch[1]}`,
            price,
            applicants,
            deadline,
            description: text.substring(0, 300),
          });
        });

        return results;
      }, BASE_URL);

      let newCount = 0;
      for (const job of jobs) {
        if (!seenIds.has(job.id) && job.title) {
          seenIds.add(job.id);
          job.matchedKeyword = keyword;
          allJobs.push(job);
          newCount++;
        }
      }
      console.log(`${newCount}件取得`);
    } catch (err) {
      console.log(`エラー: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }

    await sleep(SEARCH_DELAY_MS);
  }

  await browser.close();
  console.log(`\n合計 ${allJobs.length} 件取得`);
  return allJobs;
}

module.exports = { scrapeJobs };
