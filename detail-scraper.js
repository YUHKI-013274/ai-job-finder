// Stage0: 優先候補案件の詳細ページから、応募工程（分析・応募文作成）に必要な情報を取得する。
// 既存の検索（scraper.js）・評価（evaluator.js）ロジックは一切変更しない。
// このモジュールは classifyJobs() の結果（今すぐ応募／高単価チャレンジ／通常チャレンジ／確認候補）
// から当日の優先候補のみを選び、その詳細ページにだけアクセスする。
//
// 取得できない項目は推測で補完せず null のまま返し、fetch.missingFields に記録する。
// 必須条件・歓迎条件・応募時回答項目は「見出しから抽出できたか」だけを機械的に判定し、
// 本文の意味を読んで有無を推測することはしない（status: requires_analysis を参照）。
const { chromium } = require('playwright');
const { SEARCH_DELAY_MS } = require('./config');
const { todayJST, normalizeDateString } = require('./date-utils');

// 有効な詳細データの目標確保件数と、そのために試行してよい候補案件数の上限。
const DETAIL_FETCH_TARGET = 10;
const DETAIL_FETCH_MAX_ATTEMPTS = 15;
const DETAIL_FETCH_LIMIT = DETAIL_FETCH_TARGET; // 後方互換用エイリアス

const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
};

// 必須条件・歓迎条件・応募時回答項目の見出しパターン。
// 完全一致した行だけを見出しとして扱う（部分一致・あいまい推測はしない）。
const HEADING_PATTERNS = {
  required: ['必須条件', '必須スキル', '応募条件', 'ご応募条件', '応募資格', '必須要件'],
  welcome: ['歓迎条件', '歓迎スキル', '尚可条件', '歓迎する経験・スキル', '歓迎するスキル', 'こういった方を歓迎します', 'こういった方を歓迎します！', 'こんな方を歓迎'],
  responseItems: ['応募時にご提示いただきたい内容', '応募時にご記入いただきたい内容', '応募時にご回答いただきたい内容', '応募用テンプレート', '応募時にご提出いただきたい内容', '応募時のご質問', '応募時の質問'],
};

// 優先候補（今すぐ応募 → 高単価チャレンジ → 通常チャレンジ → 確認候補は不足時のみ）から
// 詳細取得の候補プールを最大 limit 件選ぶ。除外・保留は引数として渡さない前提（呼び出し側で除外済み）。
// 各バケットは既に評価スコア順（byRankThenScore）にソート・上限件数で切り詰め済みのため、
// 優先順位はそのまま踏襲される。limitにDETAIL_FETCH_MAX_ATTEMPTSを渡すと、
// 最初の10件が失敗した場合の補充候補（11〜15番目）まで含めたプールになる。
function selectCandidatesForDetailFetch(classified, limit = DETAIL_FETCH_TARGET) {
  const { nowApply = [], highValueChallenge = [], normalChallenge = [], confirmCandidates = [] } = classified;
  const selected = [];
  const seen = new Set();

  function addFrom(bucket, bucketLabel) {
    for (const job of bucket) {
      if (selected.length >= limit) return;
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      selected.push({ ...job, detailFetchBucket: bucketLabel });
    }
  }

  addFrom(nowApply, 'now');
  addFrom(highValueChallenge, 'high_value_challenge');
  addFrom(normalChallenge, 'normal_challenge');
  if (selected.length < limit) addFrom(confirmCandidates, 'confirm_candidate');

  return selected;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// description内で完全一致する見出し行を探し、次の見出しらしき行・末尾までを値として収集する（純粋関数版）。
// page.evaluate内で実行する版は外側スコープを参照できないため extractJobDetailFromPage 内に
// 同一ロジックを複製して持つ（Playwrightのシリアライズ制約）。この版は回帰テスト用。
function extractHeadingSection(text, headingList) {
  if (!text) return { value: null, matchedHeading: null };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cleaned = lines[i].trim().replace(/^[【■★#◆▼「]+|[】」]+$/g, '').replace(/[:：]\s*$/, '');
    const matched = headingList.find(p => cleaned === p);
    if (!matched) continue;
    const collected = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next === '') {
        if (collected.length > 0) break;
        continue;
      }
      const looksLikeNextHeading = /^[【■★#◆▼]/.test(next) || /[:：]$/.test(next);
      if (looksLikeNextHeading && collected.length > 0) break;
      collected.push(next);
    }
    return { value: collected.length > 0 ? collected.join('\n') : null, matchedHeading: matched };
  }
  return { value: null, matchedHeading: null };
}

// ブラウザコンテキスト内（page.evaluate）で実行する抽出関数。
// 外側のスコープを参照できないため、必要な定数は引数(patterns)として渡す。
function extractJobDetailFromPage(patterns) {
  function getTableFields(selector) {
    const table = document.querySelector(selector);
    const fields = {};
    if (!table) return fields;
    table.querySelectorAll('tr').forEach(tr => {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (th && td) fields[th.textContent.trim()] = td.textContent.trim().replace(/\s+/g, ' ');
    });
    return fields;
  }

  function getClientInfoRaw() {
    const container = document.querySelector('#client_detail_information_container');
    if (!container) return null;
    const raw = container.getAttribute('data');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getDescriptionText() {
    const cell = document.querySelector('.job_offer_detail_table td.confirm_outside_link');
    if (!cell) return null;
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    const text = clone.textContent.replace(/\n{3,}/g, '\n\n').trim();
    return text || null;
  }

  function getFeatureTags() {
    const table = document.querySelector('.job_offer_detail_table');
    if (!table) return [];
    const headTh = [...table.querySelectorAll('tr.table_inner_head th')]
      .find(th => th.textContent.trim() === 'この仕事の特徴');
    if (!headTh) return [];
    const dataRow = headTh.closest('tr').nextElementSibling;
    if (!dataRow) return [];
    return [...dataRow.querySelectorAll('.notice_label')].map(li => li.textContent.trim());
  }

  // description内で完全一致する見出し行を探し、次の見出しらしき行・末尾までを値として収集する。
  // 見出しが1つも一致しなければ value:null, matchedHeading:null（推測での補完はしない）。
  function extractHeadingSection(text, headingList) {
    if (!text) return { value: null, matchedHeading: null };
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const cleaned = lines[i].trim().replace(/^[【■★#◆▼「]+|[】」]+$/g, '').replace(/[:：]\s*$/, '');
      const matched = headingList.find(p => cleaned === p);
      if (!matched) continue;
      const collected = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next === '') {
          if (collected.length > 0) break;
          continue;
        }
        const looksLikeNextHeading = /^[【■★#◆▼]/.test(next) || /[:：]$/.test(next);
        if (looksLikeNextHeading && collected.length > 0) break;
        collected.push(next);
      }
      return { value: collected.length > 0 ? collected.join('\n') : null, matchedHeading: matched };
    }
    return { value: null, matchedHeading: null };
  }

  function getAttachmentsOrLinks() {
    const cell = document.querySelector('.job_offer_detail_table td.confirm_outside_link');
    const linkCount = cell ? cell.querySelectorAll('a[href]').length : 0;
    const attachEl = document.querySelector('[class*="attach" i], [class*="Attach"]');
    return { hasLinkInDescription: linkCount > 0, linkCount, hasAttachmentSection: !!attachEl };
  }

  function hasEndedBanner() {
    return /の募集は終了しています/.test(document.body.textContent);
  }

  const summaryFields = getTableFields('.job_offer_summary table.summary');
  const applicationStatusFields = getTableFields('.application_status table, .application_status_table');
  const clientInfoRaw = getClientInfoRaw();
  const description = getDescriptionText();
  const featureTags = getFeatureTags();
  const requiredConditions = extractHeadingSection(description, patterns.required);
  const welcomeConditions = extractHeadingSection(description, patterns.welcome);
  const responseItems = extractHeadingSection(description, patterns.responseItems);
  const attachmentsOrLinks = getAttachmentsOrLinks();
  const endedBannerDetected = hasEndedBanner();

  return {
    summaryFields,
    applicationStatusFields,
    clientInfoRaw,
    description,
    featureTags,
    requiredConditions,
    welcomeConditions,
    responseItems,
    attachmentsOrLinks,
    endedBannerDetected,
  };
}

// 案件概要テーブル(summaryFields)から「固定報酬制」「時間単価制」等の報酬種別ラベルと金額を取り出す。
// 既知の非報酬キー（納品希望日・掲載日・応募期限）以外の最初のキーを報酬種別とみなす。
function extractPriceFromSummary(summaryFields) {
  const KNOWN_NON_PRICE_KEYS = ['納品希望日', '掲載日', '応募期限'];
  const priceKey = Object.keys(summaryFields).find(k => !KNOWN_NON_PRICE_KEYS.includes(k));
  if (!priceKey) return { type: null, raw: null };
  return { type: priceKey, raw: summaryFields[priceKey] };
}

function parseApplicationStats(fields) {
  function toInt(label) {
    const raw = fields[label];
    if (!raw) return null;
    const m = raw.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  return {
    applied: toInt('応募した人'),
    contracted: toInt('契約した人'),
    recruiting: toInt('募集人数'),
    watching: toInt('気になる！リスト'),
  };
}

function buildClientSummary(raw) {
  if (!raw) return null;
  return {
    name: raw.userDisplayName ?? null,
    isCertifiedEmployer: raw.isCertifiedEmployer ?? null,
    isOfficiallyRecognizedAccount: raw.isOfficiallyRecognizedAccount ?? null,
    isIdentityVerified: raw.isIdentityVerified ?? null,
    isEmployerRuleCheckSucceeded: raw.isEmployerRuleCheckSucceeded ?? null,
    thanksCount: raw.userThanksCount ?? null,
    averageScore: raw.averageScore ?? null,
    jobOfferAchievementCount: raw.jobOfferAchievementCount ?? null,
    projectFinishedRate: raw.projectFinishedRate ?? null,
    isResigned: raw.isResigned ?? null,
  };
}

// 詳細ページの絶対期限表記（例: 2026年08月11日）を判定する。
// 一覧ページ側の判定（deadlineStatus）とは別に、詳細ページ時点での再確認として使う。
function resolveDetailDeadlineStatus(deadlineRawText, endedBannerDetected) {
  const normalized = normalizeDateString(deadlineRawText);
  if (endedBannerDetected) {
    return { normalized, status: 'expired' };
  }
  if (!normalized) {
    return { normalized: null, status: 'unknown' };
  }
  const today = todayJST();
  return { normalized, status: normalized >= today ? 'open' : 'expired' };
}

// 必須条件・歓迎条件・応募時回答項目の状態を判定する。
// Stage0では本文の意味を読んで「該当記載なし」を判定しない方針のため、
// このモジュールが返すstatusは 'extracted' | 'requires_analysis' | 'unavailable' の3種類のみ。
// 'not_found'（本文を確認した上で該当記載が無いと判定できた状態）は将来の分析工程用に予約するが、
// Stage0からは付与しない。
//   - extracted        : 完全一致する見出しから抽出できた
//   - requires_analysis: 本文は取得できているが、見出しが一致せず意味解析が必要
//   - unavailable      : 本文（description）自体が取得できておらず確認できない
function buildFieldStatus(headingResult, descriptionAvailable) {
  const { value, matchedHeading } = headingResult;
  let status;
  if (value !== null && matchedHeading !== null) {
    status = 'extracted';
  } else if (!descriptionAvailable) {
    status = 'unavailable';
  } else {
    status = 'requires_analysis';
  }
  return { value, status, matchedHeading, sourceAvailable: descriptionAvailable };
}

// 有効な詳細データの最低条件（jobId・案件名・URL・案件本文・クライアント情報・募集状態が確認できていること）。
// 募集状態は一覧ページとは別に詳細ページ時点で判定したdeadline.statusが確定していること（unknownは不可）。
function isValidDetail(detail) {
  if (!detail) return false;
  return !!(
    detail.jobId &&
    detail.title &&
    detail.url &&
    detail.description &&
    detail.clientSummary &&
    detail.deadline &&
    detail.deadline.status &&
    detail.deadline.status !== 'unknown'
  );
}

// 有効性の判定に使う主要項目以外（報酬・応募状況）の取得漏れを記録する。
// 必須条件・歓迎条件・応募時回答項目はstatusで状態管理しているため、ここには含めない
// （requires_analysisは「取得漏れ」ではなく「Stage0では未解析」という別概念のため）。
function buildMissingFieldsList(detail) {
  const missing = [];
  if (!detail.description) missing.push('description');
  if (!detail.clientSummary) missing.push('client');
  if (!detail.price || detail.price.raw === null) missing.push('price');
  if (!detail.deadline || detail.deadline.normalized === null) missing.push('deadline');
  if (!detail.applicationStats || Object.values(detail.applicationStats).every(v => v === null)) {
    missing.push('applicationStats');
  }
  return missing;
}

async function launchBrowserContext() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(CONTEXT_OPTIONS);
  return { browser, context };
}

// 案件詳細ページを1回だけ取得する（リトライは呼び出し側=fetchJobDetailsWithBackfillが担当）。
// 例外が発生した場合は description等がnullの detail オブジェクトを返し、error に理由を記録する。
async function fetchSingleJobDetailAttempt(context, job) {
  let page;
  try {
    page = await context.newPage();
    await page.goto(job.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.job_offer_summary, .job_offer_detail_table', { timeout: 15000 }).catch(() => null);

    const raw = await page.evaluate(extractJobDetailFromPage, HEADING_PATTERNS);

    const price = extractPriceFromSummary(raw.summaryFields);
    const deadlineRawText = raw.summaryFields['応募期限'] || null;
    const deadlineResolved = resolveDetailDeadlineStatus(deadlineRawText, raw.endedBannerDetected);
    const clientSummary = buildClientSummary(raw.clientInfoRaw);
    const applicationStats = parseApplicationStats(raw.applicationStatusFields);
    const descriptionAvailable = !!raw.description;

    return {
      jobId: job.id,
      title: job.title,
      url: job.url,
      detailFetchBucket: job.detailFetchBucket,
      price,
      deadline: {
        raw: deadlineRawText,
        normalized: deadlineResolved.normalized,
        status: deadlineResolved.status,
        endedBannerDetected: raw.endedBannerDetected,
      },
      description: raw.description,
      clientSummary,
      applicationStats,
      requiredConditions: buildFieldStatus(raw.requiredConditions, descriptionAvailable),
      welcomeConditions: buildFieldStatus(raw.welcomeConditions, descriptionAvailable),
      responseItems: buildFieldStatus(raw.responseItems, descriptionAvailable),
      featureTags: raw.featureTags,
      attachmentsOrLinks: raw.attachmentsOrLinks,
      error: null,
    };
  } catch (err) {
    const noDescriptionStatus = buildFieldStatus({ value: null, matchedHeading: null }, false);
    return {
      jobId: job.id,
      title: job.title,
      url: job.url,
      detailFetchBucket: job.detailFetchBucket,
      price: { type: null, raw: null },
      deadline: { raw: null, normalized: null, status: 'unknown', endedBannerDetected: false },
      description: null,
      clientSummary: null,
      applicationStats: { applied: null, contracted: null, recruiting: null, watching: null },
      requiredConditions: noDescriptionStatus,
      welcomeConditions: noDescriptionStatus,
      responseItems: noDescriptionStatus,
      featureTags: [],
      attachmentsOrLinks: { hasLinkInDescription: false, linkCount: 0, hasAttachmentSection: false },
      error: err.message.split('\n')[0],
    };
  } finally {
    if (page) await page.close().catch(() => null);
  }
}

// 優先順位順の候補プール（selectCandidatesForDetailFetchで最大DETAIL_FETCH_MAX_ATTEMPTS件取得したもの）から、
// 有効な詳細データをtargetValidCount件確保する。
//   1. 候補を優先順位順に1件ずつ取得
//   2. 失敗（isValidDetailがfalse）した場合、同じ案件を1回だけ再試行
//   3. 再試行でも失敗したら、その案件は不採用にして次順位の案件へ進む（＝補充）
//   4. 有効件数がtargetValidCountに達するか、試行した候補案件数がmaxAttemptsに達したら終了
// 無制限アクセスを避けるため、試行する候補案件数はmaxAttemptsで必ず打ち切る。
async function fetchJobDetailsWithBackfill(candidatePool, options = {}) {
  const targetValidCount = options.targetValidCount ?? DETAIL_FETCH_TARGET;
  const maxAttempts = options.maxAttempts ?? DETAIL_FETCH_MAX_ATTEMPTS;

  const { browser, context } = await launchBrowserContext();
  const validDetails = [];
  const allAttempts = [];
  let firstTrySuccessCount = 0;
  let retrySuccessCount = 0;
  let backfillSuccessCount = 0;
  let finalFailureCount = 0;
  let attemptedCandidateCount = 0;

  for (let i = 0; i < candidatePool.length; i++) {
    if (validDetails.length >= targetValidCount) break;
    if (attemptedCandidateCount >= maxAttempts) break;

    const job = candidatePool[i];
    const isBackfillCandidate = i >= targetValidCount; // 元々の優先10枠より後ろ＝補充で使われた候補
    attemptedCandidateCount++;

    const fetchedAt = new Date().toISOString();
    let detail = await fetchSingleJobDetailAttempt(context, job);
    let attempts = 1;
    let succeededOnFirstTry = isValidDetail(detail);

    if (!succeededOnFirstTry) {
      await sleep(SEARCH_DELAY_MS);
      detail = await fetchSingleJobDetailAttempt(context, job);
      attempts = 2;
    }

    const valid = isValidDetail(detail);
    const missingFields = buildMissingFieldsList(detail);
    const record = {
      ...detail,
      fetch: {
        fetchedAt,
        attempts,
        status: valid ? 'success' : 'failed',
        missingFields,
        error: detail.error,
      },
    };
    allAttempts.push(record);

    if (valid) {
      validDetails.push(record);
      if (isBackfillCandidate) backfillSuccessCount++;
      if (succeededOnFirstTry) firstTrySuccessCount++;
      else retrySuccessCount++;
    } else {
      finalFailureCount++;
    }

    await sleep(SEARCH_DELAY_MS);
  }

  await browser.close().catch(() => null);

  return {
    validDetails,
    allAttempts,
    stats: {
      attemptedCandidateCount,
      firstTrySuccessCount,
      retrySuccessCount,
      backfillSuccessCount,
      finalFailureCount,
      validCount: validDetails.length,
      targetReached: validDetails.length >= targetValidCount,
      maxAttemptsReached: attemptedCandidateCount >= maxAttempts,
    },
  };
}

module.exports = {
  DETAIL_FETCH_TARGET,
  DETAIL_FETCH_MAX_ATTEMPTS,
  DETAIL_FETCH_LIMIT,
  HEADING_PATTERNS,
  selectCandidatesForDetailFetch,
  extractJobDetailFromPage,
  extractHeadingSection,
  extractPriceFromSummary,
  parseApplicationStats,
  buildClientSummary,
  resolveDetailDeadlineStatus,
  buildFieldStatus,
  isValidDetail,
  buildMissingFieldsList,
  fetchSingleJobDetailAttempt,
  fetchJobDetailsWithBackfill,
};
