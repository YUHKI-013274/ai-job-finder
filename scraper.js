const { chromium } = require('playwright');
const { SEARCH_KEYWORDS, CATEGORY_SOURCES, SEARCH_DELAY_MS, PAGES_PER_KEYWORD } = require('./config');
const { todayJST, resolveDeadline, normalizeDateString } = require('./date-utils');

const BASE_URL = 'https://crowdworks.jp';
const SEARCH_URL = `${BASE_URL}/public/jobs/search`;

// ブラウザ側（extractJobsFromPage）で抽出した生の応募期限情報（deadlineRaw）を、
// 日本時間基準で実際の日付・状態（open/expired/unknown）に変換する。
// タイムゾーンに依存する計算はすべてここ（Node側）で行う。
function applyDeadlineInfo(jobs) {
  const today = todayJST();
  const checkedAt = new Date().toISOString();
  for (const job of jobs) {
    const raw = job.deadlineRaw || { daysLeft: null, monthDayText: null, expiredMarker: false, postedDateRaw: null };
    const { deadline, deadlineStatus } = resolveDeadline(raw, today);
    job.deadline = deadline;
    job.deadlineStatus = deadlineStatus;
    job.deadlineCheckedAt = checkedAt;
    job.postedDate = normalizeDateString(raw.postedDateRaw) || null;
    delete job.deadlineRaw;
  }
  return jobs;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 案件一覧ページ（キーワード検索・カテゴリ一覧のどちらも同じカード形式）から案件情報を抽出する。
// カテゴリページは主要セレクターに一致しないことが多いため、その場合はリンクベースの
// フォールバック抽出を使う（動作確認済み）。
//
// 応募期限について：実際のCrowdWorksカードを確認したところ、募集中の案件は
// 「あと3日（8月5日まで）」のような相対表示で、募集終了した案件は同じ位置に
// 「募集終了」という文字列がそのまま表示される（相対表示は出ない）。
// この関数はpage.evaluate内（ブラウザ側）で実行されるため、日付の計算（タイムゾーン依存）は
// 行わず、生の文字列情報（あと何日か／募集終了の文字列があるか／掲載日）だけを抽出する。
// 実際の日付計算・判定はNode側（scrapeJobs内、date-utils.js）で日本時間基準で行う。
function extractJobsFromPage(baseUrl) {
  const results = [];

  function extractDeadlineRaw(text) {
    const daysMatch = text.match(/あと\s*(-?\d+)\s*日/);
    const daysLeft = daysMatch ? parseInt(daysMatch[1], 10) : null;
    const monthDayMatch = text.match(/[（(]\s*(\d{1,2}月\d{1,2}日)\s*まで\s*[）)]/);
    const monthDayText = monthDayMatch ? monthDayMatch[1] : null;
    // 「募集終了」は相対表示（あと◯日）の代わりに表示されるため、相対表示が無い場合のみ有効な信号として扱う
    const expiredMarker = /募集終了/.test(text) && daysLeft === null;
    const postedMatch = text.match(/掲載日[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/);
    const postedDateRaw = postedMatch ? postedMatch[1] : null;
    return { daysLeft, monthDayText, expiredMarker, postedDateRaw };
  }

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

      const priceMatch = text.match(/([¥￥][\d,]+(?:〜[\d,]+)?(?:万円)?|[\d,]+円(?:〜[\d,]+円)?)/);
      const price = priceMatch ? priceMatch[1] : '要確認';

      const appMatch = text.match(/(\d+)\s*人が応募/);
      const applicants = appMatch ? parseInt(appMatch[1]) : null;

      results.push({
        id: idMatch[1],
        title,
        url: `${baseUrl}/public/jobs/${idMatch[1]}`,
        price,
        applicants,
        deadlineRaw: extractDeadlineRaw(text),
        description: text.substring(0, 500),
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

    results.push({
      id: idMatch[1],
      title,
      url: `${baseUrl}/public/jobs/${idMatch[1]}`,
      price,
      applicants,
      deadlineRaw: extractDeadlineRaw(text),
      description: text.substring(0, 600),
    });
  });

  return results;
}

const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
};

// 長時間起動したままのheadless_shellがページ数十枚を開いたあたりで
// クラッシュ／応答不能になることがあるため、定期的にブラウザごと再起動する。
const RECYCLE_EVERY_PAGES = 15;

async function launchBrowserContext() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(CONTEXT_OPTIONS);
  return { browser, context };
}

async function scrapeJobs() {
  let { browser, context } = await launchBrowserContext();
  let pagesOpened = 0;

  // ブラウザ/コンテキストが死んでいたら再起動してから新しいページを返す。
  // 一定ページ数ごとにも予防的に再起動する（リソースリーク対策）。
  async function getPage() {
    pagesOpened++;
    if (pagesOpened > 1 && pagesOpened % RECYCLE_EVERY_PAGES === 1) {
      await browser.close().catch(() => null);
      ({ browser, context } = await launchBrowserContext());
    }
    try {
      return await context.newPage();
    } catch {
      await browser.close().catch(() => null);
      ({ browser, context } = await launchBrowserContext());
      return await context.newPage();
    }
  }

  const allJobs = [];
  // id -> job（同一案件が複数キーワード／カテゴリに一致した場合の追跡に使う）
  const seenIds = new Map();
  const keywordStats = [];

  console.log('クラウドワークス案件を取得中...');

  for (const keyword of SEARCH_KEYWORDS) {
    let totalFound = 0, newCount = 0, dupCount = 0;
    let keywordError = null;

    for (let pageNum = 1; pageNum <= PAGES_PER_KEYWORD; pageNum++) {
      process.stdout.write(`  検索: "${keyword}"${PAGES_PER_KEYWORD > 1 ? ` (p${pageNum})` : ''} ... `);

      let page;
      try {
        page = await getPage();
      } catch (err) {
        keywordError = err.message.split('\n')[0];
        console.log(`エラー: ${keywordError}`);
        await sleep(SEARCH_DELAY_MS);
        break; // このキーワードは以降のページも諦める
      }

      try {
        const url = `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}&order=new&page=${pageNum}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        // ジョブリストが読み込まれるまで待機
        await page.waitForSelector('[data-testid="job-offer-card"], .job_offer_detail, article', {
          timeout: 15000
        }).catch(() => null);

        const jobs = applyDeadlineInfo(await page.evaluate(extractJobsFromPage, BASE_URL));
        totalFound += jobs.length;

        // 2ページ目以降で結果が0件（＝1ページ目で結果が尽きた）なら、それ以上のページ取得は無駄なので打ち切る
        if (jobs.length === 0 && pageNum > 1) {
          console.log('0件（これ以上のページなし）');
          await page.close().catch(() => null);
          break;
        }

        for (const job of jobs) {
          if (!job.title) continue;
          const existing = seenIds.get(job.id);
          if (existing) {
            // 既に別のキーワード／同キーワードの別ページで見つかっている案件
            dupCount++;
            if (!existing.matchedKeywords.includes(keyword)) existing.matchedKeywords.push(keyword);
          } else {
            job.matchedKeyword = keyword; // 後方互換：単一キーワード表示用（renderer.js等）
            job.matchedKeywords = [keyword];
            job.matchedCategories = [];
            seenIds.set(job.id, job);
            allJobs.push(job);
            newCount++;
          }
        }
        console.log(`${jobs.length}件取得`);
      } catch (err) {
        keywordError = err.message.split('\n')[0];
        console.log(`エラー: ${keywordError}`);
        await page.close().catch(() => null);
        break; // このページでエラーが出たら、それ以上のページ取得は諦める
      } finally {
        await page.close().catch(() => null);
      }

      await sleep(SEARCH_DELAY_MS);
    }

    if (keywordError && totalFound === 0) {
      keywordStats.push({ keyword, found: 0, newCount: 0, dupCount: 0, error: keywordError });
    } else {
      keywordStats.push({ keyword, found: totalFound, newCount, dupCount });
      console.log(`    → "${keyword}" 合計${totalFound}件中 新規${newCount}件（重複${dupCount}件除外）`);
    }
  }

  // 公式カテゴリ経由の取得（第1弾：資料作成・マニュアル作成のみ）。
  // キーワード検索では拾えない案件を補う目的。既存のカード抽出処理をそのまま使う。
  for (const category of CATEGORY_SOURCES) {
    process.stdout.write(`  カテゴリ: "${category.label}" ... `);

    let page;
    try {
      page = await getPage();
    } catch (err) {
      keywordStats.push({ keyword: `[カテゴリ] ${category.label}`, found: 0, newCount: 0, dupCount: 0, error: err.message.split('\n')[0] });
      console.log(`エラー: ${err.message.split('\n')[0]}`);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    try {
      const url = `${BASE_URL}${category.path}?order=new`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      await page.waitForSelector('[data-testid="job-offer-card"], .job_offer_detail, article', {
        timeout: 15000
      }).catch(() => null);

      const jobs = applyDeadlineInfo(await page.evaluate(extractJobsFromPage, BASE_URL));

      let newCount = 0;
      let dupCount = 0;
      for (const job of jobs) {
        if (!job.title) continue;
        const existing = seenIds.get(job.id);
        if (existing) {
          dupCount++;
          if (!existing.matchedCategories.includes(category.label)) existing.matchedCategories.push(category.label);
        } else {
          job.matchedKeyword = category.label; // 後方互換：単一キーワード表示欄にはカテゴリ名を使う
          job.matchedKeywords = [];
          job.matchedCategories = [category.label];
          seenIds.set(job.id, job);
          allJobs.push(job);
          newCount++;
        }
      }
      keywordStats.push({ keyword: `[カテゴリ] ${category.label}`, found: jobs.length, newCount, dupCount });
      console.log(`${newCount}件取得${dupCount > 0 ? `（重複${dupCount}件除外）` : ''}`);
    } catch (err) {
      keywordStats.push({ keyword: `[カテゴリ] ${category.label}`, found: 0, newCount: 0, dupCount: 0, error: err.message.split('\n')[0] });
      console.log(`エラー: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close().catch(() => null);
    }

    await sleep(SEARCH_DELAY_MS);
  }

  await browser.close().catch(() => null);
  console.log(`\n合計 ${allJobs.length} 件取得`);
  return { jobs: allJobs, keywordStats };
}

module.exports = { scrapeJobs };
