// Knowledge駆動評価ロジックの回帰テスト（v5：既出＝履歴化・継続候補・検索範囲拡張）
//
// これまでの修正（証拠分離・動画編集除外・確認候補新設等）は維持しつつ、
// 今回は「既出を除外理由にしない」「継続候補が評価パイプラインへ通る」
// 「台本作成／イラスト制作／AI業務支援の新規検索語が正しく分類される」ことを追加でテストする。
//
// 実行: node regression-test.js

const evaluator = require('./evaluator');
const config = require('./config');
const dateUtils = require('./date-utils');
const detailScraper = require('./detail-scraper');
const analyzer = require('./analyzer');
const { verifyKnowledgeSync } = require('./knowledge-sync-check');
const fs = require('fs');
const path = require('path');
const aiAnalyzer = require('./ai-analyzer');
const { loadJobAiAnalysis, JOB_AI_ANALYSIS_DIR, JOB_AI_ANALYSIS_FAILED_DIR, saveJobAiAnalysis, saveFailedAttempt } = require('./ai-analysis-store');
const { createCostTracker, estimateCostUsd } = require('./ai-usage-log');
const { saveJobAnalysis, JOB_ANALYSIS_DIR } = require('./analysis-store');
const applicationPacketBuilder = require('./application-packet-builder');
const { loadApplicationPacket, APPLICATION_PACKETS_DIR } = require('./application-packet-store');

let idCounter = 1;
function job(title, description, price = '3,000円', deadlineFields = {}) {
  return {
    id: String(idCounter++),
    title,
    description,
    price,
    url: 'https://crowdworks.jp/public/jobs/' + idCounter,
    applicants: null,
    deadline: deadlineFields.deadline !== undefined ? deadlineFields.deadline : null,
    deadlineStatus: deadlineFields.deadlineStatus !== undefined ? deadlineFields.deadlineStatus : 'unknown',
    deadlineCheckedAt: deadlineFields.deadlineCheckedAt || new Date().toISOString(),
    matchedKeyword: '(テスト)',
  };
}

let pass = 0, total = 0;
function record(label, ok, detail) {
  total++; if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (detail) console.log(`    ${detail}`);
}

console.log('='.repeat(100));
console.log('■ 既出＝履歴化・継続候補の回帰確認');
console.log('='.repeat(100) + '\n');

{
  // 過去に取得済み（seenMapに存在）だが未応募・未見送りの案件 → 除外されず評価パイプラインへ通ることを確認
  const testJob = job('BtoB向けサービス紹介資料の作成', '企業向けサービス紹介資料を作成していただきます。', '8,000円');
  const seenMap = { [testJob.id]: { firstSeen: '2026-07-20', title: testJob.title, url: testJob.url, currentTier: 'normal_challenge' } };
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded } = evaluator.classifyJobs([testJob], {}, seenMap, {});
  const all = [...nowApply, ...highValueChallenge, ...normalChallenge, ...confirmCandidates, ...holds];
  const found = all.find(j => j.id === testJob.id);
  record('継続候補（既出だが未応募・未見送り）は除外されず評価される', !!found && excluded.length === 0,
    found ? `jobStatus=${found.jobStatus} / displayTier=${found.displayTier} / firstSeen=${found.firstSeen}` : '評価対象から消えている');
}
{
  const testJob = job('生成AI活用による業務改善支援', 'プロジェクトマネジメント経験を活かして業務改善を支援します。', '1,000,000円');
  const { excluded } = evaluator.classifyJobs([testJob], { [testJob.id]: {} }, {}, {});
  record('応募済みは候補へ戻らない', excluded.length === 1 && excluded[0].excludeReason === '応募済み');
}
{
  const testJob = job('生成AI活用による業務改善支援', 'プロジェクトマネジメント経験を活かして業務改善を支援します。', '1,000,000円');
  const { excluded } = evaluator.classifyJobs([testJob], {}, {}, { [testJob.id]: { reason: '条件が合わない' } });
  record('見送り済みは候補へ戻らない', excluded.length === 1 && excluded[0].excludeReason === '見送り');
}
{
  // 新着（未取得）の場合はjobStatus='新着'になることを確認
  const testJob = job('BtoB向けサービス紹介資料の作成', '企業向けサービス紹介資料を作成していただきます。', '8,000円');
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates } = evaluator.classifyJobs([testJob], {}, {}, {});
  const all = [...nowApply, ...highValueChallenge, ...normalChallenge, ...confirmCandidates];
  const found = all[0];
  record('未取得の案件はjobStatus=新着になる', found && found.jobStatus === '新着');
}

console.log('\n' + '='.repeat(100));
console.log('■ 検索範囲拡張の分類確認（台本作成／イラスト制作／AI業務支援）');
console.log('='.repeat(100) + '\n');

record('新規検索語がconfig.SEARCH_KEYWORDSに追加されている',
  ['イラスト制作', '台本作成', 'シナリオ作成', 'AI業務支援', 'AIディレクション'].every(k => config.SEARCH_KEYWORDS.includes(k)),
  config.SEARCH_KEYWORDS.filter(k => ['イラスト制作','台本作成','シナリオ作成','AI業務支援','AIディレクション'].includes(k)).join('・'));

{
  const testJob = job('YouTube企業紹介動画の台本作成', 'YouTube企業紹介動画の台本・シナリオを作成していただく文章のお仕事です。', '5,000円');
  const j = evaluator.evaluateJob(testJob);
  record('台本作成はライティング（seo_article）として評価され、動画編集として除外されない',
    !j.excluded && j.genre && j.genre.includes('ライティング'),
    `capabilityStatus=${j.capabilityStatus} / genre=${j.genre}`);
}
{
  const testJob = job('YouTube動画編集者募集｜カット編集・テロップ入れ', 'YouTube動画のカット編集・テロップ入れをお願いします。', '10,000円');
  const j = evaluator.evaluateJob(testJob);
  record('動画編集（カット編集・テロップ入れ）は引き続き対応不可', j.excluded && j.excludeReason === '対応不可（Knowledge判定）');
}
{
  const testJob = job('note記事の挿入イラスト制作', 'note記事に挿入するイラストを制作していただきます。', '5,000円');
  const j = evaluator.evaluateJob(testJob);
  record('イラスト制作はCanva・画像制作カテゴリーとして評価される',
    !j.excluded, `capabilityStatus=${j.capabilityStatus} / genre=${j.genre}`);
}
{
  const testJob = job('AI業務支援スタッフ募集', 'AIを活用した業務支援を行っていただきます。', '10,000円');
  const j = evaluator.evaluateJob(testJob);
  record('AI業務支援はAI活用カテゴリーとして評価される',
    !j.excluded, `capabilityStatus=${j.capabilityStatus} / genre=${j.genre}`);
}

console.log('\n' + '='.repeat(100));
console.log('■ 明確な除外案件の維持確認（戻ってはいけない）');
console.log('='.repeat(100) + '\n');

record('資格必須は戻らない', (() => {
  const j = evaluator.evaluateJob(job('看護師資格保有者限定の医療コンサル案件', '看護師資格保有者のみ応募可能です。', '50,000円'));
  return j.excluded && j.excludeReason === '必須条件不一致（資格・専門実務）';
})());
record('動画編集は戻らない（新規キーワード追加後も）', (() => {
  const j = evaluator.evaluateJob(job('【高単価】YouTube動画編集者募集', 'YouTube動画のカット編集をお願いします。', '20,000円'));
  return j.excluded && j.excludeReason === '対応不可（Knowledge判定）';
})());
record('SNS運用代行は戻らない', (() => {
  const j = evaluator.evaluateJob(job('【高単価】Instagram運用スタッフ募集', 'Instagramアカウントの運用をお任せします。', '80,000円'));
  return j.excluded && j.excludeReason === 'SNS運用代行';
})());
record('単純作業・アンケートは戻らない', (() => {
  const j = evaluator.evaluateJob(job('簡単アンケートに答えるだけ', 'アンケートに回答していただくだけの簡単なお仕事です。', '1,000円'));
  return j.excluded && j.excludeReason === '対応不可（Knowledge判定）';
})());
record('未使用ツール必須は戻らない', (() => {
  const j = evaluator.evaluateJob(job('Illustrator必須のロゴデザイン案件', 'Illustratorを使用してロゴデザインを作成していただきます。', '10,000円'));
  return j.excluded && j.excludeReason === '必須条件不一致（指定ツール）';
})());

console.log('\n' + '='.repeat(100));
console.log('■ 保存データ（既出2,751件）での継続候補シミュレーション');
console.log('='.repeat(100) + '\n');
{
  const fs = require('fs');
  const seen = JSON.parse(fs.readFileSync('data/seen_jobs.json', 'utf8'));
  const applied = JSON.parse(fs.readFileSync('data/applied_jobs.json', 'utf8'));
  const status = JSON.parse(fs.readFileSync('data/job_status.json', 'utf8'));
  const entries = Object.entries(seen).slice(0, 400);
  const jobs400 = entries.map(([id, v]) => ({
    id, title: v.title, description: '', price: '要確認', url: v.url, applicants: null, deadline: null, matchedKeyword: '(継続候補サンプル)',
  }));
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded } = evaluator.classifyJobs(jobs400, applied, seen, status);
  console.log(`既出400件サンプルを継続候補として再評価（タイトルのみ・本文なしのため下限見積もり） →`);
  console.log(`今すぐ応募:${nowApply.length} / 高単価チャレンジ:${highValueChallenge.length} / 通常チャレンジ:${normalChallenge.length} / 確認候補:${confirmCandidates.length} / 保留:${holds.length} / 除外:${excluded.length}`);
  const reasonCounts = {};
  excluded.forEach(j => { reasonCounts[j.excludeReason] = (reasonCounts[j.excludeReason] || 0) + 1; });
  console.log('除外理由内訳:', JSON.stringify(reasonCounts));
  const total400 = nowApply.length + highValueChallenge.length + normalChallenge.length + confirmCandidates.length;
  console.log(`継続候補400件サンプルのうち応募検討候補になった数: ${total400}件（${(total400/400*100).toFixed(1)}%）`);
}

console.log('\n' + '='.repeat(100));
console.log('■ 応募期限の正規化・判定（date-utils.js）');
console.log('='.repeat(100) + '\n');

record('日付表記4形式を正しく解析できる：2026年07月28日', dateUtils.normalizeDateString('2026年07月28日') === '2026-07-28');
record('日付表記4形式を正しく解析できる：2026年7月28日', dateUtils.normalizeDateString('2026年7月28日') === '2026-07-28');
record('日付表記4形式を正しく解析できる：2026/07/28', dateUtils.normalizeDateString('2026/07/28') === '2026-07-28');
record('日付表記4形式を正しく解析できる：2026-07-28', dateUtils.normalizeDateString('2026-07-28') === '2026-07-28');

{
  // ご指摘のPowerPoint案件を再現：2026年7月28日が応募期限、判定基準日が2026年8月2日 → 募集終了
  const r = dateUtils.resolveDeadline({ daysLeft: null, monthDayText: null, expiredMarker: true, postedDateRaw: null }, '2026-08-02');
  record('2026年7月28日期限の案件が、2026年8月2日時点で募集終了になる（募集終了マーカー検出）', r.deadlineStatus === 'expired', JSON.stringify(r));
}
{
  // 「あと0日」＝本日が期限 → 応募候補に残る（募集終了ではない）
  const r = dateUtils.resolveDeadline({ daysLeft: 0, monthDayText: null, expiredMarker: false, postedDateRaw: null }, '2026-08-02');
  record('本日期限（あと0日）の案件は応募候補に残る（open）', r.deadlineStatus === 'open' && r.deadline === '2026-08-02', JSON.stringify(r));
}
{
  // 「あと5日」＝明日以降 → 応募候補に残る
  const r = dateUtils.resolveDeadline({ daysLeft: 5, monthDayText: null, expiredMarker: false, postedDateRaw: null }, '2026-08-02');
  record('明日以降期限（あと5日）の案件は応募候補に残る（open）', r.deadlineStatus === 'open' && r.deadline === '2026-08-07', JSON.stringify(r));
}
{
  // 期限情報が一切取得できない場合 → unknown（自動除外しない）
  const r = dateUtils.resolveDeadline({ daysLeft: null, monthDayText: null, expiredMarker: false, postedDateRaw: null }, '2026-08-02');
  record('期限情報が取得できない案件はunknownになる（expiredにしない）', r.deadlineStatus === 'unknown' && r.deadline === null, JSON.stringify(r));
}

console.log('\n' + '='.repeat(100));
console.log('■ 応募期限判定のclassifyJobs統合確認');
console.log('='.repeat(100) + '\n');

{
  const expiredJob = job('【高単価案件！】会社紹介のPowerPoint・PDF資料作成をご依頼いたします', 'PowerPoint・PDF資料を作成していただきます。', '30,000円', { deadline: null, deadlineStatus: 'expired' });
  const { excluded } = evaluator.classifyJobs([expiredJob], {}, {}, {});
  record('募集終了の案件は今すぐ応募/高単価/通常/確認候補から除外される', excluded.length === 1 && excluded[0].excludeReason === '募集終了');
}
{
  const openJob = job('BtoB向けサービス紹介資料の作成', '企業向けサービス紹介資料を作成していただきます。', '8,000円', { deadline: '2026-08-10', deadlineStatus: 'open' });
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates, excluded } = evaluator.classifyJobs([openJob], {}, {}, {});
  const found = [...nowApply, ...highValueChallenge, ...normalChallenge, ...confirmCandidates].length === 1;
  record('期限内（open）の案件は通常どおり評価される', found && excluded.length === 0);
}
{
  const unknownJob = job('BtoB向けサービス紹介資料の作成', '企業向けサービス紹介資料を作成していただきます。', '8,000円', { deadline: null, deadlineStatus: 'unknown' });
  const j = evaluator.evaluateJob(unknownJob);
  record('期限不明の案件は自動除外されず「⚠️ 応募期限未取得・応募前に確認」が表示される',
    !j.excluded && j.confirmBeforeApply.includes('⚠️ 応募期限未取得・応募前に確認'));
}
{
  // 新着・継続候補の両方へ期限判定が適用されることの確認
  const expiredContinuing = job('継続候補だが期限切れの案件', '説明文', '10,000円', { deadline: null, deadlineStatus: 'expired' });
  const seenMap = { [expiredContinuing.id]: { firstSeen: '2026-07-01', title: expiredContinuing.title, url: expiredContinuing.url } };
  const { excluded } = evaluator.classifyJobs([expiredContinuing], {}, seenMap, {});
  record('継続候補でも期限切れなら除外される（新着・継続候補どちらにも期限判定が適用される）',
    excluded.length === 1 && excluded[0].excludeReason === '募集終了');
}
{
  const testJob = job('生成AI活用による業務改善支援', 'プロジェクトマネジメント経験を活かして業務改善を支援します。', '1,000,000円', { deadline: '2026-08-10', deadlineStatus: 'open' });
  const { excluded } = evaluator.classifyJobs([testJob], { [testJob.id]: {} }, {}, {});
  record('応募済み・見送り済みの既存処理は期限判定の追加後も壊れない（応募済み）', excluded.length === 1 && excluded[0].excludeReason === '応募済み');
}

console.log('\n' + '='.repeat(100));
console.log('■ 案件詳細取得（Stage0）の回帰確認');
console.log('='.repeat(100) + '\n');

{
  // 今すぐ応募→高単価チャレンジ→通常チャレンジの順で最大10件選ばれ、確認候補は不足時のみ追加されることを確認
  const mk = (n, tier) => Array.from({ length: n }, (_, i) => ({ id: `${tier}-${i}`, title: `${tier}案件${i}`, displayTier: tier }));
  const classified = {
    nowApply: mk(4, 'now'),
    highValueChallenge: mk(3, 'high_value_challenge'),
    normalChallenge: mk(5, 'normal_challenge'),
    confirmCandidates: mk(5, 'confirm_candidate'),
  };
  const selected = detailScraper.selectCandidatesForDetailFetch(classified, 10);
  const buckets = selected.map(j => j.detailFetchBucket);
  const expectedOrder = [
    'now', 'now', 'now', 'now',
    'high_value_challenge', 'high_value_challenge', 'high_value_challenge',
    'normal_challenge', 'normal_challenge', 'normal_challenge',
  ];
  record('詳細取得候補の選定順序（今すぐ応募→高単価→通常、10件で打ち切り）',
    selected.length === 10 && JSON.stringify(buckets) === JSON.stringify(expectedOrder),
    `件数=${selected.length} / 内訳=${JSON.stringify(buckets)}`);
}
{
  // 4バケット合計が10件未満のときのみ確認候補が使われることを確認
  const mk = (n, tier) => Array.from({ length: n }, (_, i) => ({ id: `${tier}-${i}`, title: `${tier}案件${i}`, displayTier: tier }));
  const classified = {
    nowApply: mk(2, 'now'),
    highValueChallenge: mk(1, 'high_value_challenge'),
    normalChallenge: mk(1, 'normal_challenge'),
    confirmCandidates: mk(10, 'confirm_candidate'),
  };
  const selected = detailScraper.selectCandidatesForDetailFetch(classified, 10);
  const confirmCount = selected.filter(j => j.detailFetchBucket === 'confirm_candidate').length;
  record('今すぐ応募/高単価/通常の合計が10件未満の場合のみ確認候補で補充される',
    selected.length === 10 && confirmCount === 6, `確認候補から補充=${confirmCount}件`);
}
{
  const classified = { nowApply: [], highValueChallenge: [], normalChallenge: [], confirmCandidates: [] };
  const selected = detailScraper.selectCandidatesForDetailFetch(classified, 10);
  record('候補が0件の場合は空配列を返す（存在しないデータを作らない）', Array.isArray(selected) && selected.length === 0);
}
{
  const price = detailScraper.extractPriceFromSummary({ '固定報酬制': '30,000円 〜 50,000円', '納品希望日': '-', '掲載日': '2026年07月28日', '応募期限': '2026年08月11日' });
  record('報酬種別・金額の抽出（固定報酬制）', price.type === '固定報酬制' && price.raw === '30,000円 〜 50,000円', JSON.stringify(price));
}
{
  const price = detailScraper.extractPriceFromSummary({ '納品希望日': '-', '掲載日': '2026年07月28日', '応募期限': '2026年08月11日' });
  record('報酬種別が見つからない場合はnullを返す（推測で補完しない）', price.type === null && price.raw === null);
}
{
  const stats = detailScraper.parseApplicationStats({ '応募した人': '71 人', '契約した人': '0 人', '募集人数': '8 人', '気になる！リスト': '79 人' });
  record('応募状況（応募/契約/募集/気になる）の数値抽出', stats.applied === 71 && stats.contracted === 0 && stats.recruiting === 8 && stats.watching === 79, JSON.stringify(stats));
}
{
  const stats = detailScraper.parseApplicationStats({});
  record('応募状況が取得できない場合は全項目nullになる（推測で埋めない）',
    stats.applied === null && stats.contracted === null && stats.recruiting === null && stats.watching === null);
}
{
  const client = detailScraper.buildClientSummary({
    userDisplayName: 'yokoiaa1', isCertifiedEmployer: false, isOfficiallyRecognizedAccount: false,
    isIdentityVerified: false, isEmployerRuleCheckSucceeded: false, userThanksCount: 5,
    averageScore: 0, jobOfferAchievementCount: 1, projectFinishedRate: 0, isResigned: false,
  });
  record('クライアント情報（本人確認・発注ルールチェック等）の構造化',
    client.name === 'yokoiaa1' && client.isIdentityVerified === false && client.isEmployerRuleCheckSucceeded === false && client.jobOfferAchievementCount === 1,
    JSON.stringify(client));
}
{
  const client = detailScraper.buildClientSummary(null);
  record('クライアント情報を取得できない場合はnullを返す（推測で補完しない）', client === null);
}
{
  const today = dateUtils.todayJST();
  const future = dateUtils.addDaysToDateString(today, 5);
  const [y, m, d] = future.split('-');
  const result = detailScraper.resolveDetailDeadlineStatus(`${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`, false);
  record('詳細ページの絶対期限（未来日）はopenと判定される', result.status === 'open' && result.normalized === future, JSON.stringify(result));
}
{
  const today = dateUtils.todayJST();
  const past = dateUtils.addDaysToDateString(today, -5);
  const [y, m, d] = past.split('-');
  const result = detailScraper.resolveDetailDeadlineStatus(`${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`, false);
  record('詳細ページの絶対期限（過去日）はexpiredと判定される', result.status === 'expired', JSON.stringify(result));
}
{
  const result = detailScraper.resolveDetailDeadlineStatus(null, true);
  record('募集終了バナーを検出した場合は期限文字列が無くてもexpiredと判定される（安全側）', result.status === 'expired');
}
{
  const result = detailScraper.resolveDetailDeadlineStatus(null, false);
  record('期限文字列も終了バナーも無い場合はunknownになる（推測しない）', result.status === 'unknown' && result.normalized === null);
}
{
  const text = '仕事の内容です。\n\n必須条件\n・Webライティング経験1年以上\n・チャットツールでの報連相ができる方\n\n歓迎条件\n・SEOの知識がある方\n\n以上、よろしくお願いします。';
  const required = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.required);
  const welcome = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.welcome);
  record('見出し完全一致による必須条件・歓迎条件の抽出',
    required.matchedHeading === '必須条件' && required.value.includes('Webライティング経験1年以上')
    && welcome.matchedHeading === '歓迎条件' && welcome.value.includes('SEOの知識がある方'),
    JSON.stringify({ required, welcome }));
}
{
  // 「応募用テンプレート」のような、実際のCrowdWorks案件で確認された表記も既知パターンとして拾えることを確認
  const text = '仕事の詳細です。\n\n応募用テンプレート\n・お名前：\n・稼働時間：\n\nよろしくお願いします。';
  const items = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.responseItems);
  record('応募時の指定回答項目（応募用テンプレート表記）の抽出', items.matchedHeading === '応募用テンプレート' && items.value.includes('お名前'));
}
{
  // 実案件（13392611）で確認：鉤括弧「」で囲まれた見出し（「応募時の質問」）は、従来の括弧除去
  // （【】のみ対応）では見出し扱いされず、直後の質問リストごと取りこぼしていた。鉤括弧にも対応する。
  const text = '仕事の内容です。\n\n「応募時の質問」\n1.稼働可能な曜日・時間帯を教えてください。\n2.関連経験の有無を教えてください。\n\n以上、よろしくお願いします。';
  const items = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.responseItems);
  record('鉤括弧「」で囲まれた見出し（「応募時の質問」）も見出しとして認識される（実案件13392611で確認された表記）',
    items.matchedHeading === '応募時の質問' && items.value.includes('稼働可能な曜日・時間帯') && items.value.includes('関連経験の有無'),
    JSON.stringify(items));
}
{
  // 既存パターン（【】＋「ご」あり表記）が今回の変更後も引き続き機能することを確認（非退行）
  const text = '仕事の内容です。\n\n【応募時のご質問】\n・稼働可能時間を教えてください。\n\nよろしくお願いします。';
  const items = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.responseItems);
  record('既存の見出しパターン（【応募時のご質問】）は今回の修正後も引き続き認識される（非退行）',
    items.matchedHeading === '応募時のご質問' && items.value.includes('稼働可能時間'));
}
{
  // 見出しが一切存在しない自由記述本文では、value/matchedHeadingともにnullのままであることを確認（推測で埋めない）
  const text = 'ライティングのお仕事をお願いします。詳細は追ってご連絡します。';
  const required = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.required);
  const items = detailScraper.extractHeadingSection(text, detailScraper.HEADING_PATTERNS.responseItems);
  record('見出しが存在しない本文では必須条件・指定回答項目ともにnullのまま（推測で補完しない）',
    required.value === null && required.matchedHeading === null && items.value === null && items.matchedHeading === null);
}
{
  const detail = {
    description: '本文あり', clientSummary: null, price: { type: null, raw: null },
    deadline: { normalized: null }, applicationStats: { applied: null, contracted: null, recruiting: null, watching: null },
  };
  const missing = detailScraper.buildMissingFieldsList(detail);
  record('取得できなかった項目の一覧化（missingFields）が漏れなく機能する（client/price/deadline/applicationStats）',
    missing.includes('client') && missing.includes('price') && missing.includes('deadline')
    && missing.includes('applicationStats') && !missing.includes('description'),
    JSON.stringify(missing));
}
{
  // 見出しから抽出できた場合は status: 'extracted'
  const status = detailScraper.buildFieldStatus({ value: 'Webライティング経験1年以上', matchedHeading: '必須条件' }, true);
  record('見出し抽出できた項目は status=extracted になる', status.status === 'extracted' && status.sourceAvailable === true, JSON.stringify(status));
}
{
  // 本文は取得できているが見出しが一致しない場合は status: 'requires_analysis'（=推測で not_found にはしない）
  const status = detailScraper.buildFieldStatus({ value: null, matchedHeading: null }, true);
  record('本文はあるが見出し不一致の項目は status=requires_analysis になる（本文の意味からnot_foundと推測しない）',
    status.status === 'requires_analysis' && status.sourceAvailable === true, JSON.stringify(status));
}
{
  // 本文自体が取得できていない場合は status: 'unavailable'
  const status = detailScraper.buildFieldStatus({ value: null, matchedHeading: null }, false);
  record('本文自体が取得できない場合は status=unavailable になる', status.status === 'unavailable' && status.sourceAvailable === false, JSON.stringify(status));
}
{
  // Stage0では常に extracted/requires_analysis/unavailable の3種類のみを返し、not_foundは付与しないことを確認
  const cases = [
    detailScraper.buildFieldStatus({ value: 'x', matchedHeading: '必須条件' }, true),
    detailScraper.buildFieldStatus({ value: null, matchedHeading: null }, true),
    detailScraper.buildFieldStatus({ value: null, matchedHeading: null }, false),
  ];
  record('Stage0が付与するstatusは extracted/requires_analysis/unavailable の3種類のみ（not_foundは付与しない）',
    cases.every(c => ['extracted', 'requires_analysis', 'unavailable'].includes(c.status)));
}
{
  const validDetail = {
    jobId: '1', title: '案件名', url: 'https://crowdworks.jp/public/jobs/1',
    description: '本文', clientSummary: { name: 'client' }, deadline: { status: 'open' },
  };
  record('jobId/案件名/URL/本文/クライアント情報/募集状態が揃っていればisValidDetail=true', detailScraper.isValidDetail(validDetail) === true);
}
{
  const missingClient = {
    jobId: '1', title: '案件名', url: 'https://crowdworks.jp/public/jobs/1',
    description: '本文', clientSummary: null, deadline: { status: 'open' },
  };
  record('クライアント情報が無い場合はisValidDetail=false', detailScraper.isValidDetail(missingClient) === false);
}
{
  const unknownStatus = {
    jobId: '1', title: '案件名', url: 'https://crowdworks.jp/public/jobs/1',
    description: '本文', clientSummary: { name: 'client' }, deadline: { status: 'unknown' },
  };
  record('募集状態が未確定(unknown)の場合はisValidDetail=false（不明を有効扱いしない）', detailScraper.isValidDetail(unknownStatus) === false);
}
{
  record('detailオブジェクトが無い場合はisValidDetail=false', detailScraper.isValidDetail(null) === false);
}
{
  // 優先10件のプールに補充用の11〜15番目まで含めて渡せることを確認（バックフィル用プール生成）
  const mk = (n, tier) => Array.from({ length: n }, (_, i) => ({ id: `${tier}-${i}`, title: `${tier}案件${i}`, displayTier: tier }));
  const classified = {
    nowApply: mk(10, 'now'), highValueChallenge: mk(5, 'high_value_challenge'),
    normalChallenge: [], confirmCandidates: [],
  };
  const pool = detailScraper.selectCandidatesForDetailFetch(classified, detailScraper.DETAIL_FETCH_MAX_ATTEMPTS);
  record('バックフィル用に最大15件のプールを取得できる（10件を超えて11〜15番目も含む）',
    pool.length === 15 && pool[10].detailFetchBucket === 'high_value_challenge');
}

console.log('\n' + '='.repeat(100));
console.log('■ 案件分析データ生成（Stage1）の回帰確認');
console.log('='.repeat(100) + '\n');

let detailIdCounter = 1;
function detailFixture(overrides = {}) {
  const id = String(1000 + detailIdCounter++);
  return {
    jobId: id,
    title: overrides.title || 'PowerPointによる提案資料作成のお仕事',
    url: `https://crowdworks.jp/public/jobs/${id}`,
    detailFetchBucket: overrides.detailFetchBucket || 'now',
    price: overrides.price || { type: '固定報酬制', raw: '30,000円 〜 50,000円' },
    deadline: overrides.deadline || { raw: '2099年08月10日', normalized: '2099-08-10', status: 'open', endedBannerDetected: false },
    description: overrides.description !== undefined ? overrides.description : '弊社の新規事業提案資料をPowerPointで作成していただける方を募集します。\n\n必須条件\n・PowerPoint操作経験\n\n応募用テンプレート\n・稼働可能時間：',
    clientSummary: overrides.clientSummary !== undefined ? overrides.clientSummary : { name: 'client', isCertifiedEmployer: false, isOfficiallyRecognizedAccount: false, isIdentityVerified: true, isEmployerRuleCheckSucceeded: true, thanksCount: 1, averageScore: 4, jobOfferAchievementCount: 1, projectFinishedRate: 80, isResigned: false },
    applicationStats: overrides.applicationStats || { applied: 1, contracted: 0, recruiting: 1, watching: 0 },
    requiredConditions: overrides.requiredConditions || { value: 'PowerPoint操作経験', status: 'extracted', matchedHeading: '必須条件', sourceAvailable: true },
    welcomeConditions: overrides.welcomeConditions || { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: overrides.responseItems || { value: '稼働可能時間：', status: 'extracted', matchedHeading: '応募用テンプレート', sourceAvailable: true },
    featureTags: [],
    attachmentsOrLinks: { hasLinkInDescription: false, linkCount: 0, hasAttachmentSection: false },
    fetch: overrides.fetch || { fetchedAt: new Date().toISOString(), attempts: 1, status: 'success', missingFields: [], error: null },
  };
}

{
  const analysis = analyzer.analyzeJobDetail(detailFixture());
  record('有効な案件（応募可能・直接証明）にjobIdで分析JSONが生成される',
    analysis.jobId && analysis.jobSummary.jobId === analysis.jobId && analysis.analysisVersion === analyzer.ANALYSIS_VERSION);
}
{
  const detail = detailFixture();
  const before = JSON.stringify(detail);
  analyzer.analyzeJobDetail(detail);
  record('分析処理が案件詳細JSON（元オブジェクト）を変更しない（上書きしない）', JSON.stringify(detail) === before);
}
{
  // 対応不可（動画編集）案件ではKnowledgeにない経験・実績が生成されないことを確認
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'YouTube動画編集者募集', description: 'YouTube動画のカット編集・テロップ入れをお願いします。経験者歓迎です。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('対応不可（Knowledge判定）の案件ではusableExperienceが空になる（存在しない経験を作らない）',
    analysis.searchSystemReevaluation.capabilityStatus === '対応不可' && analysis.usableExperience.length === 0);
}
{
  // 使用禁止情報（Sales Knowledge 9-1〜9-3）が応募材料（avoidExpressions/prohibitedClaims）に
  // 「使わないよう警告する側」として含まれることを確認し、逆にusableExperienceの文言が
  // 使用禁止リストの表現とそのまま一致しないことを確認する
  const analysis = analyzer.analyzeJobDetail(detailFixture());
  const prohibitedExpr = analysis.proposalMaterials.avoidExpressions;
  const usableTexts = analysis.usableExperience.map(e => e.knowledgeText);
  const overlap = usableTexts.filter(t => prohibitedExpr.includes(t));
  record('使用禁止表現リストが応募材料に含まれ、使用可能経験の文言と重複しない（誇張表現が混入しない）',
    prohibitedExpr.length > 0 && overlap.length === 0);
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'YouTube動画編集者募集', description: 'YouTube動画のカット編集をお願いします。経験者歓迎です。',
  }));
  const experienceFit = analysis.fitAssessment.find(f => f.condition === '必須経験（経験者歓迎等の記載）');
  record('明確な条件不一致（対応不可×経験者歓迎の明示）はnot_metになる', experienceFit && experienceFit.status === 'not_met');
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  const requiredFit = analysis.fitAssessment.find(f => f.condition === '必須条件（本文抽出）');
  record('本文から条件を抽出できていない場合はunknownになる（判断不能を誤ってmet/not_metにしない）',
    requiredFit && requiredFit.status === 'unknown');
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture());
  record('クライアントの本質的な目的（deeperGoal）は常にrequires_ai_analysisとして保存される（断定しない）',
    analysis.clientPurpose.deeperGoal.status === 'requires_ai_analysis' && analysis.clientPurpose.deeperGoal.value === null);
  record('個別化ポイント（personalizationPoints）は常にrequires_ai_analysisとして保存される（断定しない）',
    analysis.proposalMaterials.personalizationPoints.status === 'requires_ai_analysis');
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    responseItems: { value: '稼働可能時間：\n自己紹介：', status: 'extracted', matchedHeading: '応募用テンプレート', sourceAvailable: true },
  }));
  record('抽出済みの必須回答項目（responseItems）が応募文生成材料（requiredAnswers）へ引き継がれる',
    analysis.proposalMaterials.requiredAnswers.includes('稼働可能時間：\n自己紹介：'));
  record('抽出済みの必須回答項目がAI引き継ぎデータ（aiHandoff.input.extractedConditions）へ引き継がれる',
    analysis.aiHandoff.input.extractedConditions.responseItems === '稼働可能時間：\n自己紹介：');
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture());
  record('requires_analysisの項目（deliverable等）はフィールド自体が消失せず残る（valueはnullでもキーは存在）',
    Object.prototype.hasOwnProperty.call(analysis.requestSummary, 'deliverable')
    && analysis.requestSummary.deliverable.status === 'requires_analysis');
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture());
  const hasToolQuestion = analysis.missingInformation.some(m => /使用可能ツール|使えるツール/.test(m.item));
  record('Knowledgeに既に記載済みの使用可能ツールは不足情報として再度質問されない', !hasToolQuestion);
}
{
  const detail = detailFixture({ fetch: { fetchedAt: new Date().toISOString(), attempts: 2, status: 'failed', missingFields: ['description'], error: 'timeout' }, description: null, clientSummary: null });
  const result = analyzer.isEligibleForAnalysis(detail, {});
  record('取得失敗案件はStage1の対象から除外される', result.eligible === false && result.reason.includes('取得'));
}
{
  const detail = detailFixture({ deadline: { raw: '2020年01月01日', normalized: '2020-01-01', status: 'expired', endedBannerDetected: true } });
  const result = analyzer.isEligibleForAnalysis(detail, {});
  record('募集終了案件はStage1の対象から除外される', result.eligible === false && result.reason === '募集終了');
}
{
  const detail = detailFixture();
  const result = analyzer.isEligibleForAnalysis(detail, { appliedMap: { [detail.jobId]: {} } });
  record('応募済み案件はStage1の対象から除外される', result.eligible === false && result.reason === '応募済み');
}
{
  const detail = detailFixture();
  const result = analyzer.isEligibleForAnalysis(detail, { rejectedMap: { [detail.jobId]: { reason: 'x' } } });
  record('見送り済み案件はStage1の対象から除外される', result.eligible === false && result.reason === '見送り済み');
}
{
  const detailA = detailFixture();
  const detailB = detailFixture();
  const analysisA = analyzer.analyzeJobDetail(detailA);
  const analysisB = analyzer.analyzeJobDetail(detailB);
  record('各案件の分析結果がjobIdで分離される（別案件のデータが混入しない）',
    analysisA.jobId !== analysisB.jobId && analysisA.jobSummary.url !== analysisB.jobSummary.url);
}
{
  const check = analyzer.checkKnowledgeConsistency();
  record('Sales Knowledge / Common Knowledgeの矛盾チェックが正常に実行できる（現状データでは矛盾なし）',
    typeof check.hasConflict === 'boolean' && Array.isArray(check.conflicts) && check.hasConflict === false);
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture());
  const nonUsableLevel = analysis.usableExperience.some(e => e.evidenceLevel !== '使用可能');
  record('usableExperienceには「使用可能」区分以外（要確認・未証明・使用禁止）が混入しない', !nonUsableLevel);
}
{
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'デザイナー募集（詳細は応相談）', description: 'デザイナー募集です。詳細は応相談。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('Knowledgeだけで断定できない案件（確認候補）の応募推奨度はholdになる',
    analysis.searchSystemReevaluation.capabilityStatus === '確認候補' && analysis.recommendation.value === 'hold');
}

console.log('\n' + '='.repeat(100));
console.log('■ Stage1安全性・精度修正（品質監査対応）の回帰確認');
console.log('='.repeat(100) + '\n');

{
  // 修正1：stop案件は応募材料が完全に空になり、proposalGenerationAllowed=falseになる
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: '動画編集者募集', description: 'YouTube動画のカット編集・テロップ入れをお願いします。経験者歓迎です。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('stop案件はproposalGenerationAllowed=falseになる', analysis.recommendation.value === 'stop' && analysis.proposalGenerationAllowed === false);
  record('stop案件はusableExperience/evidence/clientValue/portfolioCandidatesがすべて空になる',
    analysis.usableExperience.length === 0 && analysis.evidence.direct.length === 0 && analysis.evidence.alternative.length === 0
    && analysis.clientValue.length === 0 && analysis.portfolioCandidates.length === 0);
  record('stop案件はproposalMaterialsの応募材料系フィールドがすべて空になる',
    analysis.proposalMaterials.centralMessage === null && analysis.proposalMaterials.usableExperienceIds.length === 0
    && analysis.proposalMaterials.usableEvidenceIds.length === 0 && analysis.proposalMaterials.portfolioIds.length === 0
    && analysis.proposalMaterials.personalizationPoints.status === 'not_applicable');
}
{
  // 修正2：Illustrator必須（大文字小文字を問わず）かつKnowledgeに使用実績がない場合はtool fit=not_met、recommendation=stop
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'illustratorでスライド作成', description: 'YouTube台本をスライド化する仕事です。\n\n応募条件\n・illustratorが使える方\n・報連相ができる方',
    requiredConditions: { value: '・illustratorが使える方\n・報連相ができる方', status: 'extracted', matchedHeading: '応募条件', sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('小文字illustratorでも大文字Illustratorと同一視してtool fit=not_metになる',
    analysis.toolFit.hasHardBlock === true && analysis.toolFit.perTool[0].tool === 'Illustrator' && analysis.toolFit.perTool[0].status === 'not_met');
  record('Illustrator必須ツール不一致によりrecommendation=stopになる', analysis.recommendation.value === 'stop');
  record('Illustrator必須ツール不一致によりusableExperienceが生成されない（ライティング実績等を根拠にしない）', analysis.usableExperience.length === 0);
}
{
  // 修正2：Notion等、使用不可リストにはないが使用実績も無いツールはunknown扱いになる（stopにはしない）
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'Notionでマニュアル作成', description: 'Notion上に弊社ツールのマニュアルを作成してください。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('Notionのように使用実績未確認のツールはtool fit=unknownになる（not_metにはしない）',
    analysis.toolFit.hasUnknown === true && analysis.toolFit.hasHardBlock === false
    && analysis.toolFit.perTool.some(t => t.tool === 'Notion' && t.status === 'unknown'));
  record('未確認ツールはmissingInformationへ追加される', analysis.missingInformation.some(m => m.item.includes('Notion') && m.item.includes('確認')));
  record('未確認ツールがあってもrecommendationはstopにならない（proceed_after_confirmation/hold等）', analysis.recommendation.value !== 'stop');
}
{
  // 修正3：要求ツール（Canva）とカテゴリー既定ツール（PowerPoint）が食い違う場合、ツールを直接証拠にせず、
  // 証拠区分を格下げする（直接証明→強い代替証明）。能力証拠（deliverable等）は引き続き使う。
  // 「資料作成実績の有無」（proposal_documentへ一致させる語）を質問文に含めつつ、実際の作業指示は
  // Canva使用を明記する、jobId 13318382と同型のテキスト（既存カテゴリーを維持したままツール不一致を検証する）。
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'セミナー資料をCanvaで作成', description: '① Canvaを活用して資料を作製してください。セミナー動画をもとに視覚資料へ落とし込みます。\n\n【応募・選考について】\n・資料作成実績の有無\n・ポートフォリオ',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  const toolEntry = analysis.usableExperience.find(e => e.evidenceKind === 'tool');
  record('要求ツール（Canva）とカテゴリー既定ツール（PowerPoint）が不一致の場合、ツールを直接証拠として提示しない', !toolEntry);
  record('ツール不一致時、能力証拠（制作実績・自主制作等）は引き続き使用可能な経験として残る',
    analysis.usableExperience.some(e => e.evidenceKind === 'deliverable' || e.evidenceKind === 'self_produced'));
  record('ツール不一致によりtoolMismatchNoteが記録される', typeof analysis.toolMismatchNote === 'string' && analysis.toolMismatchNote.includes('Canva'));
}
{
  // 修正4：「商品開発」等の汎用語のみでは飲食テーマに接続しない
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: '歩行器の取扱説明書デザイン', description: '弊社では現在、歩行器の商品開発を進めております。取扱説明書のデザインを作成いただける方を募集します。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('「商品開発」単独では飲食カテゴリー・飲食テーマに接続しない（医療機器等の無関係な案件へ誤接続しない）',
    analysis.searchSystemReevaluation.categoryMatchOverridden === true
    && analysis.usableExperience.every(e => !e.knowledgeText.includes('飲食')));
  record('「商品開発」単独での誤接続防止時、飲食業22年・飲食事業改善提案資料が出力されない', analysis.usableExperience.length === 0 && analysis.portfolioCandidates.length === 0);
}
{
  // 修正4：飲食関連語が併記されている場合は正しく飲食テーマに接続する（過剰除外していないことの確認）
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'カフェの新メニュー商品開発資料', description: 'カフェで提供する新メニューの商品開発について、店舗運営の観点から提案資料を作成してください。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('飲食関連語（カフェ・店舗運営等）が併記されている場合は飲食テーマ接続を維持する（過剰除外しない）',
    analysis.searchSystemReevaluation.categoryMatchOverridden === false);
}
{
  // 修正5：禁止事項の中にしか出現しない語でカテゴリー誤判定しない（「ブログへのアップロード禁止」の「ブログ」）
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'illustratorでスライド作成', description: 'YouTube台本をスライド化する仕事です。\n\n応募条件\n・illustratorが使える方\n\n【禁止事項】\n著作権は当方に譲渡されますので、動画サイトやブログへのアップロード等の再利用は禁止です。',
    requiredConditions: { value: '・illustratorが使える方', status: 'extracted', matchedHeading: '応募条件', sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('禁止事項の中にしか出現しない語（ブログ）でライティング案件と誤判定しない',
    analysis.searchSystemReevaluation.categoryMatchOverridden === true
    && analysis.searchSystemReevaluation.categoryMatchNotes.some(n => n.includes('ブログ')));
}
{
  // 修正5：業務内容として書かれた語は、質問文の近くにあっても正しく使う（過剰除外の確認）
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'セミナー音声に合わせた資料作成', description: '① Canvaを活用して資料を作製してください。\n\n【応募・選考について】\n・ビジネス資料の作成実績の有無\n・その他ポートフォリオ',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('質問文中の語（資料作成実績の有無）だけでは却下せず、業務内容に関係する場合はカテゴリーを維持する',
    analysis.searchSystemReevaluation.categoryMatchOverridden === false);
}
{
  // 修正6：SNS運用代行の除外を、制作/運用の文脈で再判定する（写真・構成提供・Canva単発制作は解除対象）
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'カフェ紹介Instagram投稿制作', description: '写真や素材はこちらでご用意します。カフェ紹介Instagramアカウントのフィード投稿作成をお願いします。Canva等を使用したデザイン制作です。デザインやSNS運用に興味がある方も歓迎です。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('運用代行の記載がなく制作のみのSNS案件はstop解除される', analysis.searchSystemReevaluation.excluded === false && analysis.recommendation.value !== 'stop');
  record('SNS除外解除の根拠（本文記載）が保存される', analysis.searchSystemReevaluation.snsExclusionReassessment && analysis.searchSystemReevaluation.snsExclusionReassessment.overridden === true);
}
{
  // 修正6：運用代行（コメント対応・アカウント管理等）を含む場合はstopを維持する
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'SNS運用スタッフ募集', description: 'Instagramアカウントの投稿企画・コメント対応・DM対応を含む継続的な運用をお願いします。SNS運用に興味がある方歓迎です。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  record('運用代行を示す記載（コメント対応等）がある場合はSNS除外を維持する（stopのまま）',
    analysis.searchSystemReevaluation.excluded === true && analysis.recommendation.value === 'stop' && analysis.proposalGenerationAllowed === false);
}
{
  // 修正7：同一資産（deliverableEvidenceとselfProducedEvidenceの表記違い）はassetIdで1件に統合される
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'SEO記事のライティング', description: 'SEO記事のライティングをお願いします。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  }));
  const assetIds = analysis.portfolioCandidates.map(p => p.assetId);
  record('表記の異なる同一資産（AIライティング5記事の2表記）がportfolioCandidatesで1件に統合される',
    new Set(assetIds).size === assetIds.length, JSON.stringify(analysis.portfolioCandidates.map(p => p.assetName)));
  const cvAssetIds = analysis.clientValue.map(c => c.assetId).filter(Boolean);
  record('同一資産がclientValueでも重複しない', new Set(cvAssetIds).size === cvAssetIds.length);
}
{
  // 修正8：正規Knowledge（Markdown）とJSキャッシュのハッシュが一致することを確認する
  const sync = verifyKnowledgeSync();
  record('正規Knowledge（Markdown）とJSキャッシュのハッシュが現状一致している（Stage1が正常実行できる状態）', sync.allInSync === true, JSON.stringify(sync.results.map(r => ({ cache: r.cacheName, inSync: r.inSync }))));
}
{
  // 修正8：ハッシュが不一致の場合はStage1処理を停止する（KnowledgeOutOfSyncError）
  const yukiProfile = require('./knowledge/yuki_profile');
  const originalHash = yukiProfile.sourceContentHash;
  yukiProfile.sourceContentHash = 'wrong_hash_for_test';
  let threw = false;
  let errorIsCorrectType = false;
  try {
    analyzer.assertKnowledgeInSync();
  } catch (err) {
    threw = true;
    errorIsCorrectType = err instanceof analyzer.KnowledgeOutOfSyncError;
  } finally {
    yukiProfile.sourceContentHash = originalHash; // 必ず元に戻す
  }
  record('Markdownとキャッシュのハッシュが不一致の場合、Stage1処理を例外で停止する（黙って古いキャッシュを使わない）', threw && errorIsCorrectType);
  // 復元後、正常に動作することも確認（テストの副作用が残らないことの確認）
  const syncAfterRestore = verifyKnowledgeSync();
  record('テスト用に書き換えたハッシュを復元後、同期チェックが正常に戻る', syncAfterRestore.allInSync === true);
}
{
  // 修正9：見出しが完全一致しなくても、応募時の回答を求める記載を「存在しないと断定せず」保持する
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: 'セミナー資料作成', description: '① Canvaを活用して資料を作製してください。\n\n【応募・選考について】\nご応募頂く際は、以下ご質問の回答を頂けますと幸いです。\n\n・資料作成実績の有無\n・ポートフォリオ',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true }, // Stage0の見出し完全一致では抽出されない想定
  }));
  record('見出し不一致でも「応募・選考について」等の緩やかな記載を検知しrequires_ai_analysisとして保持する（消失させない）',
    analysis.conditions.responseItems.status === 'requires_ai_analysis' && analysis.conditions.responseItems.evidenceText.includes('資料作成実績の有無'));
  record('緩やかに検知した回答項目候補がAI引き継ぎデータへ残る',
    analysis.aiHandoff.input.extractedConditions.responseItemsCandidateExcerpt && analysis.aiHandoff.input.extractedConditions.responseItemsCandidateExcerpt.includes('ポートフォリオ'));
  record('緩やかに検知した回答項目候補がaiHandoff.tasksへ引き継ぎタスクとして追加される',
    analysis.aiHandoff.tasks.some(t => t.includes('conditions.responseItems')));
}
{
  // 実案件（13257814）で確認：「ご応募の際には、必ず下記の質問にお答えください。①…②…」という
  // 頻出表現は、従来のソフトシグナル一覧のどれにも一致せず、質問が丸ごと失われていた。
  const analysis = analyzer.analyzeJobDetail(detailFixture({
    title: '閉院に向けたタイムスケジュール作成',
    description: '医療法人の閉院タイムスケジュールを作成してください。\n\nご応募の際には、必ず下記の質問にお答えください。\n①活かせるスキルや経験をお知らせください。\n②類似の課題を検討したご経験はありますか。\n③想定される納品形式を教えてください。',
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
    responseItems: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true }, // Stage0の見出し完全一致では抽出されない想定
  }));
  record('「下記の質問にお答えください」等の頻出表現も緩やかに検知しrequires_ai_analysisとして保持する（実案件13257814で確認された欠落パターン）',
    analysis.conditions.responseItems.status === 'requires_ai_analysis'
    && analysis.conditions.responseItems.evidenceText.includes('①活かせるスキルや経験')
    && analysis.conditions.responseItems.evidenceText.includes('③想定される納品形式'),
    JSON.stringify(analysis.conditions.responseItems));
}

// Stage2aのテストは（モッククライアント経由とはいえ）非同期関数を呼ぶため、
// CommonJSではトップレベルawaitが使えず、この区間だけ即時実行の非同期関数でまとめる。
(async () => {

console.log('\n' + '='.repeat(100));
console.log('■ Stage2a（AI意味解析）の回帰確認：ネットワーク・APIキー不要な範囲');
console.log('='.repeat(100) + '\n');

// テストにはStage2a対象3件（13318382/13330967/13354051）を使わず、実データを流用できる
// 別のStage1分析結果（13326710・13330166）を使う。ライブ実行時にStage2a対象案件の結果を
// 誤って上書きしないため。
const TEST_JOB_ID = '13326710'; // proceed_after_confirmation（成功系のテストに使う）
const TEST_STOP_JOB_ID = '13330166'; // stop（送信されないことのテストに使う）

function cleanupAiAnalysisArtifacts(jobId) {
  const successPath = path.join(JOB_AI_ANALYSIS_DIR, `${jobId}.json`);
  if (fs.existsSync(successPath)) fs.unlinkSync(successPath);
  if (fs.existsSync(JOB_AI_ANALYSIS_FAILED_DIR)) {
    fs.readdirSync(JOB_AI_ANALYSIS_FAILED_DIR)
      .filter(f => f.startsWith(`${jobId}_`))
      .forEach(f => fs.unlinkSync(path.join(JOB_AI_ANALYSIS_FAILED_DIR, f)));
  }
}

function makeMockClient(responses) {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const next = responses[Math.min(call, responses.length - 1)];
        call++;
        if (next.throwError) throw next.throwError;
        return next.response;
      },
    },
  };
}

function mockResponse(obj, inputTokens = 1000, outputTokens = 300) {
  return { response: { content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: inputTokens, output_tokens: outputTokens } } };
}

function buildValidMockOutput(stage1Analysis) {
  const evidenceSnippet = stage1Analysis.aiHandoff.input.jobDescriptionFull.slice(10, 30); // 本文からそのまま引用
  const experienceId = stage1Analysis.usableExperience[0].id;
  return {
    jobId: stage1Analysis.jobId,
    clientPurpose: { deeperGoal: '手順を正確に理解してもらうための資料整備', deeperGoalEvidenceText: [evidenceSnippet], confidence: 'medium' },
    conditionsSupplement: { requiredEmbedded: [], welcomeEmbedded: [], responseItemsResolved: [] },
    personalizationPoints: [{ point: '画像付きで手順を解説する構成が求められている', evidenceText: evidenceSnippet }],
    safetyReviewSupplement: [],
    experienceConnections: [{ usableExperienceId: experienceId, connectionNote: '資料構成の経験を転用できる', fitStrength: 'moderate', limitation: '同一業界（FX）の直接経験はない' }],
    missingInformationAdditions: [],
    unresolvedItems: [],
    stage2Concerns: { found: false, details: [] },
    selfReport: { usedOnlyProvidedFacts: true, inventedFactsDetected: false },
  };
}

{
  // buildStage2Input：AIへ任せない範囲のフィールド（報酬・期限・recommendation・proposalGenerationAllowed等）を
  // ペイロードに含めていないことを確認する
  const stage1Real = require('./data/private/job_analysis/' + TEST_JOB_ID + '.json');
  const input = aiAnalyzer.buildStage2Input(stage1Real);
  record('buildStage2Inputはjobデータ本文・Stage1抽出情報を含む', input.jobId === TEST_JOB_ID && typeof input.jobDescriptionFull === 'string' && input.jobDescriptionFull.length > 0);
  record('buildStage2Inputはrecommendation/proposalGenerationAllowedを含まない（AIへ任せない範囲）',
    !Object.prototype.hasOwnProperty.call(input, 'recommendation') && !Object.prototype.hasOwnProperty.call(input, 'proposalGenerationAllowed'));
  record('buildStage2Inputは報酬・応募期限の生データを含まない（AIへ任せない範囲）',
    !Object.prototype.hasOwnProperty.call(input, 'price') && !Object.prototype.hasOwnProperty.call(input, 'deadline'));
  record('buildStage2InputはKnowledge全文ではなく該当カテゴリーの抜粋のみを含む',
    typeof input.salesKnowledgeExcerpt === 'object' && !JSON.stringify(input).includes('yuki_sales_knowledge_v1.md 第'));
}
{
  const stage1Real = require('./data/private/job_analysis/' + TEST_JOB_ID + '.json');
  const jobDescriptionFull = stage1Real.aiHandoff.input.jobDescriptionFull;
  const validOutput = buildValidMockOutput(stage1Real);

  const okResult = aiAnalyzer.validateStage2Output(validOutput, stage1Real, jobDescriptionFull);
  record('正常な出力（実在ID・本文引用のみ）はvalid=trueになる', okResult.valid === true, JSON.stringify(okResult.errors));

  const wrongJobId = { ...validOutput, jobId: 'wrong-id' };
  const r1 = aiAnalyzer.validateStage2Output(wrongJobId, stage1Real, jobDescriptionFull);
  record('jobId不一致はvalid=false・retryable=falseになる（再試行させず失敗）', r1.valid === false && r1.retryable === false);

  const withForbiddenKey = { ...validOutput, recommendation: 'proceed' };
  const r2 = aiAnalyzer.validateStage2Output(withForbiddenKey, stage1Real, jobDescriptionFull);
  record('Stage1確定フィールド（recommendation）の混入はvalid=false・retryable=falseになる', r2.valid === false && r2.retryable === false);

  const fakeExperienceId = { ...validOutput, experienceConnections: [{ usableExperienceId: 'invented:not_real', connectionNote: 'x', fitStrength: 'strong', limitation: '' }] };
  const r3 = aiAnalyzer.validateStage2Output(fakeExperienceId, stage1Real, jobDescriptionFull);
  record('Stage1に存在しないusableExperienceIdの参照はvalid=false・retryable=falseになる（創作扱い）', r3.valid === false && r3.retryable === false);

  const fabricatedEvidence = { ...validOutput, personalizationPoints: [{ point: 'x', evidenceText: 'この文字列は案件本文には存在しません_テスト用' }] };
  const r4 = aiAnalyzer.validateStage2Output(fabricatedEvidence, stage1Real, jobDescriptionFull);
  record('案件本文に実在しない根拠テキストはvalid=false・retryable=falseになる', r4.valid === false && r4.retryable === false);

  const bannedExpression = { ...validOutput, clientPurpose: { ...validOutput.clientPurpose, deeperGoal: stage1Real.aiHandoff.input.mustNotUse.prohibitedExpressions[0] } };
  const r5 = aiAnalyzer.validateStage2Output(bannedExpression, stage1Real, jobDescriptionFull);
  record('使用禁止表現の混入はvalid=false・retryable=falseになる', r5.valid === false && r5.retryable === false);

  const r6 = aiAnalyzer.validateStage2Output('not-an-object', stage1Real, jobDescriptionFull);
  record('JSON形式が不正（オブジェクトでない）な場合はvalid=false・retryable=trueになる（再試行対象）', r6.valid === false && r6.retryable === true);
}
{
  // APIキー未設定時は外部送信せず例外で安全停止する（実際にキーが無い状態で確認）
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let threw = false, correctType = false;
  try {
    aiAnalyzer.assertApiKeyConfigured();
  } catch (err) {
    threw = true;
    correctType = err instanceof aiAnalyzer.ApiKeyNotConfiguredError;
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
  record('ANTHROPIC_API_KEY未設定時はApiKeyNotConfiguredErrorで安全停止する（外部送信しない）', threw && correctType);
}
{
  // stop案件はAPIへ一切送信しない（呼ばれたら即エラーになるモッククライアントで検証）
  const poisonedClient = { messages: { create: async () => { throw new Error('APIが呼び出された：stop案件は送信禁止のはずが違反している'); } } };
  const costTracker = createCostTracker({ costLimitUsd: 100 });
  const result = await aiAnalyzer.runStage2ForJob(poisonedClient, TEST_STOP_JOB_ID, { model: 'claude-sonnet-5', costTracker });
  record('stop判定の案件はAPIを呼び出さずskippedになる', result.outcome === 'skipped' && result.reason.includes('stop'));
}
{
  // 正常系：有効な出力を返すモックで成功保存されることを確認し、テスト後に後始末する
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
  const stage1Real = require('./data/private/job_analysis/' + TEST_JOB_ID + '.json');
  const validOutput = buildValidMockOutput(stage1Real);
  const client = makeMockClient([mockResponse(validOutput)]);
  const costTracker = createCostTracker({ costLimitUsd: 100 });
  const result = await aiAnalyzer.runStage2ForJob(client, TEST_JOB_ID, { model: 'claude-sonnet-5', costTracker });
  record('有効な出力は1回の試行で成功し、非公開領域へ保存される', result.outcome === 'success' && result.attempts === 1);
  const saved = loadJobAiAnalysis(TEST_JOB_ID);
  record('保存されたStage2結果ファイルにStage1の確定フィールド（recommendation等）が含まれない',
    saved && !Object.prototype.hasOwnProperty.call(saved.output, 'recommendation') && !Object.prototype.hasOwnProperty.call(saved.output, 'proposalGenerationAllowed'));
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
}
{
  // 一時的エラー（JSON形式不正）は再試行し、2回目で成功すればattempts=2で保存される
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
  const stage1Real = require('./data/private/job_analysis/' + TEST_JOB_ID + '.json');
  const validOutput = buildValidMockOutput(stage1Real);
  const client = makeMockClient([
    { response: { content: [{ type: 'text', text: '{ this is not valid json' }], usage: { input_tokens: 900, output_tokens: 50 } } },
    mockResponse(validOutput),
  ]);
  const costTracker = createCostTracker({ costLimitUsd: 100 });
  const result = await aiAnalyzer.runStage2ForJob(client, TEST_JOB_ID, { model: 'claude-sonnet-5', costTracker });
  record('JSON形式不正は再試行され、2回目で成功する（attempts=2）', result.outcome === 'success' && result.attempts === 2);
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
}
{
  // 事実不整合（存在しないID参照）は再試行せず即失敗する
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
  const stage1Real = require('./data/private/job_analysis/' + TEST_JOB_ID + '.json');
  const invalidOutput = { ...buildValidMockOutput(stage1Real), experienceConnections: [{ usableExperienceId: 'invented:not_real', connectionNote: 'x', fitStrength: 'strong', limitation: '' }] };
  const client = makeMockClient([mockResponse(invalidOutput), mockResponse(buildValidMockOutput(stage1Real))]); // 2回目は正常だが呼ばれないはず
  const costTracker = createCostTracker({ costLimitUsd: 100 });
  const result = await aiAnalyzer.runStage2ForJob(client, TEST_JOB_ID, { model: 'claude-sonnet-5', costTracker });
  record('存在しないID参照（創作扱い）は再試行せず1回で失敗する（attempts=1）', result.outcome === 'failed' && result.attempts === 1);
  const savedAfterFailure = loadJobAiAnalysis(TEST_JOB_ID);
  record('失敗時は正式なStage2結果ファイルを作らない（失敗記録のみ分離保存）', savedAfterFailure === null && !!result.failedRecordPath);
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
}
{
  // コスト上限：呼び出し前チェックで到達していればAPIを呼ばずskippedになる
  const poisonedClient = { messages: { create: async () => { throw new Error('コスト上限到達後にAPIが呼び出された'); } } };
  const costTracker = createCostTracker({ costLimitUsd: 0.00001 });
  costTracker.recordCall({ jobId: 'dummy', model: 'claude-sonnet-5', inputTokens: 100000, outputTokens: 100000, success: true, retryCount: 0 });
  const result = await aiAnalyzer.runStage2ForJob(poisonedClient, TEST_JOB_ID, { model: 'claude-sonnet-5', costTracker });
  record('累計費用が上限に達している場合、APIを呼び出さずskippedになる', result.outcome === 'skipped' && result.reason.includes('上限'));
}
{
  // 異常なトークン使用の検知（上限未到達でも停止する）
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
  const stage1Real = require('./data/private/job_analysis/' + TEST_JOB_ID + '.json');
  const client = makeMockClient([{ response: { content: [{ type: 'text', text: JSON.stringify(buildValidMockOutput(stage1Real)) }], usage: { input_tokens: 999999, output_tokens: 100 } } }]);
  const costTracker = createCostTracker({ costLimitUsd: 100, maxInputTokensPerCall: 20000 });
  const result = await aiAnalyzer.runStage2ForJob(client, TEST_JOB_ID, { model: 'claude-sonnet-5', costTracker });
  record('異常に多い入力トークンを検知した場合は再試行せず失敗する', result.outcome === 'failed' && result.attempts === 1 && result.error.type === 'abnormal_usage');
  cleanupAiAnalysisArtifacts(TEST_JOB_ID);
}
{
  // コストトラッカー単体の動作確認
  const tracker = createCostTracker({ costLimitUsd: 1 });
  record('コスト上限未到達時はcanProceed=trueになる', tracker.canProceed().ok === true);
  const cost = estimateCostUsd('claude-sonnet-5', 1_000_000, 1_000_000);
  record('claude-sonnet-5の費用計算が公式単価（入力$3・出力$15/1Mトークン）と一致する', Math.abs(cost - 18) < 0.0001, `計算結果=${cost}`);
}

console.log('\n' + '='.repeat(100));
console.log('■ Application Packet（応募準備パケット）の回帰確認');
console.log('='.repeat(100) + '\n');

// Stage1・Stage2の実データ（永峯勇気の実案件）は日次実行のたびに書き換わるため、
// Application Packetのテストは実データを流用せず、テスト専用の合成jobId（英字を含み実案件IDと
// 衝突しない）でStage1・Stage2の最小フィクスチャを作り、テスト後に必ず片付ける。
function makeStage1Analysis(jobId, overrides = {}) {
  const base = {
    jobId,
    proposalGenerationAllowed: true,
    recommendation: { value: 'proceed', reasons: ['テスト用固定理由'] },
    sourceFiles: { jobDetail: `data/private/job_details/${jobId}.json` },
    jobSummary: {
      jobId,
      title: 'テスト案件タイトル',
      url: `https://crowdworks.jp/public/jobs/${jobId}`,
      price: { type: '固定報酬制', raw: '10,000円' },
      deadline: { raw: '2026年12月31日', normalized: '2026-12-31', status: 'open', endedBannerDetected: false },
      currentTier: 'now',
    },
    clientInfo: {
      name: 'テストクライアント', isIdentityVerified: false, isEmployerRuleCheckSucceeded: true,
      reviewCount: null, reviewCountNote: 'テスト', averageScore: 4.5, thanksCount: 10,
      jobOfferAchievementCount: 5, applied: 1, contracted: 0, recruiting: 1,
    },
    searchSystemReevaluation: { rank: 'A', capabilityStatus: '応募可能', evidenceType: '強い代替証明', matchedCapabilities: ['構成力'] },
    safetyReview: { unclearCompensation: { status: 'no_signal_detected', evidence: [] } },
    toolFit: { requiredTools: [], source: null, perTool: [], hasHardBlock: false, hasUnknown: false, overallStatus: 'no_tool_specified' },
    toolMismatchNote: null,
    usableExperience: [{
      id: 'test_category:paid', assetId: 'test_asset_1', name: '受注・実務経験', knowledgeText: 'テスト経験',
      connectionReason: 'テスト', evidenceKind: 'paid', evidenceLevel: '使用可能', clientValue: 'テスト提供価値', usableInProposal: true,
    }],
    clientValue: [{
      assetId: 'test_asset_1', experience: 'テスト経験', capability: 'テスト能力', rationale: 'テスト理由',
      evidence: '強い代替証明', clientValue: 'テスト提供価値', status: 'extracted', expressionExample: 'テスト表現例',
    }],
    conditions: {
      required: { value: null, status: 'requires_analysis', evidenceText: null, source: 'job_detail' },
      responseItems: { value: null, status: 'unavailable', evidenceText: null, source: 'job_detail' },
    },
    proposalMaterials: {
      centralMessage: 'テスト中心メッセージ', usableExperienceIds: ['test_category:paid'], usableEvidenceIds: ['test_asset_1'],
      portfolioIds: [], requiredAnswers: [], avoidExpressions: [], prohibitedClaims: [],
    },
    portfolioCandidates: [],
    missingInformation: [],
    aiHandoff: { required: false, tasks: [], input: { jobDescriptionFull: 'これはテスト用の案件本文です。' } },
  };
  return { ...base, ...overrides };
}

function cleanupApplicationPacketArtifacts(jobId) {
  const stage1Path = path.join(JOB_ANALYSIS_DIR, `${jobId}.json`);
  if (fs.existsSync(stage1Path)) fs.unlinkSync(stage1Path);
  const stage2Path = path.join(JOB_AI_ANALYSIS_DIR, `${jobId}.json`);
  if (fs.existsSync(stage2Path)) fs.unlinkSync(stage2Path);
  if (fs.existsSync(JOB_AI_ANALYSIS_FAILED_DIR)) {
    fs.readdirSync(JOB_AI_ANALYSIS_FAILED_DIR)
      .filter(f => f.startsWith(`${jobId}_`))
      .forEach(f => fs.unlinkSync(path.join(JOB_AI_ANALYSIS_FAILED_DIR, f)));
  }
  const packetPath = path.join(APPLICATION_PACKETS_DIR, `${jobId}.json`);
  if (fs.existsSync(packetPath)) fs.unlinkSync(packetPath);
}

{
  // シナリオ1: Stage2ありの場合、Stage1＋Stage2の両方がパケットへ格納される
  const jobId = 'TEST_PKT_STAGE2_OK';
  cleanupApplicationPacketArtifacts(jobId);
  const stage1 = makeStage1Analysis(jobId);
  saveJobAnalysis(jobId, stage1);
  const stage2Output = {
    clientPurpose: { deeperGoal: 'テスト深掘り目的', deeperGoalEvidenceText: ['テスト用'], confidence: 'medium' },
    personalizationPoints: [{ point: 'テスト個別化ポイント', evidenceText: 'テスト用' }],
  };
  saveJobAiAnalysis(jobId, { jobId, analyzedAt: '2026-08-20T00:00:00.000Z', output: stage2Output });

  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('Stage2結果がある場合はbuilt=trueでstage2.status=successになる', result.built === true && result.packet.stage2.status === 'success');
  record('Stage2ありの場合、stage2.outputにStage2の実出力がそのまま格納される',
    JSON.stringify(result.packet.stage2.output) === JSON.stringify(stage2Output));
  record('Stage2ありの場合、sourceFiles.stage2Analysisが設定される',
    result.packet.sourceFiles.stage2Analysis === `data/private/job_ai_analysis/${jobId}.json`);
  record('Stage1由来の必須項目（タイトル・URL・報酬・ランク・応募区分）もあわせて格納される',
    result.packet.job.title === stage1.jobSummary.title
    && result.packet.job.url === stage1.jobSummary.url
    && result.packet.evaluation.rank === 'A'
    && result.packet.evaluation.applyCategory === 'now');
  const saved = loadApplicationPacket(jobId);
  record('生成したApplication Packetがdata/private/application_packets/へ保存される', saved !== null && saved.jobId === jobId);
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // シナリオ2: Stage2なしの場合、Stage1だけでパケットが完成し、stage2.status=not_runになる
  const jobId = 'TEST_PKT_STAGE2_NONE';
  cleanupApplicationPacketArtifacts(jobId);
  const stage1 = makeStage1Analysis(jobId);
  saveJobAnalysis(jobId, stage1);

  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('Stage2結果がない場合でもStage1だけでbuilt=trueになる（日次パイプラインを止めない）', result.built === true);
  record('Stage2未実行の場合はstage2.status=not_runになる', result.packet.stage2.status === 'not_run');
  record('Stage2未実行の場合はsourceFiles.stage2Analysisがnullになる', result.packet.sourceFiles.stage2Analysis === null);
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // シナリオ3: Stage2が失敗記録のみ残している場合、stage2.status=failedとして状態を明示する
  const jobId = 'TEST_PKT_STAGE2_FAILED';
  cleanupApplicationPacketArtifacts(jobId);
  const stage1 = makeStage1Analysis(jobId);
  saveJobAnalysis(jobId, stage1);
  saveFailedAttempt(jobId, {
    jobId, stage2Version: 'stage2a-v1', attemptedAt: '2026-08-20T00:00:00.000Z', model: 'claude-sonnet-5',
    attempts: 1, lastError: { type: 'validation_failed', message: 'テスト用失敗理由' }, lastUsage: null,
  });

  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('Stage2が失敗のみの場合でもStage1だけでbuilt=trueになる', result.built === true);
  record('Stage2失敗の場合はstage2.status=failedになり、失敗理由も引き継がれる（存在しない事実を補完しない）',
    result.packet.stage2.status === 'failed' && result.packet.stage2.error.type === 'validation_failed');
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // シナリオ4: 必須情報不足（本文から抽出できていない項目・クライアント情報の一部欠落）でも
  // 推測で埋めず、Stage1の不明ステータス・不足情報リストをそのまま引き継ぐ
  const jobId = 'TEST_PKT_MISSING_INFO';
  cleanupApplicationPacketArtifacts(jobId);
  const stage1 = makeStage1Analysis(jobId, {
    clientInfo: {
      name: null, isIdentityVerified: null, isEmployerRuleCheckSucceeded: null, reviewCount: null,
      reviewCountNote: 'テスト', averageScore: null, thanksCount: null, jobOfferAchievementCount: null,
      applied: null, contracted: null, recruiting: null,
    },
    conditions: {
      required: { value: null, status: 'requires_analysis', evidenceText: null, source: 'job_detail' },
      responseItems: { value: null, status: 'requires_ai_analysis', evidenceText: 'テスト抜粋', source: 'rule(soft_signal)' },
    },
    missingInformation: [
      { item: '必須条件の内容確認', detail: null, reason: '本文から見出しで抽出できず、意味解析待ちのため' },
      { item: 'テスト不足項目2', detail: null, reason: 'テスト理由2' },
    ],
  });
  saveJobAnalysis(jobId, stage1);

  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('必須情報が不足していてもbuilt=trueになる（欠落を理由に停止しない）', result.built === true);
  record('不明な項目は推測で埋めず、Stage1のstatus表現（requires_analysis等）をそのまま引き継ぐ',
    result.packet.applicationQuestions.requiredConditions.status === 'requires_analysis'
    && result.packet.client.name === null);
  record('不足情報リスト（missingInformation）がそのまま件数どおり引き継がれる', result.packet.missingInformation.length === 2);
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // 統合確認（実案件13392611のパターン）：鉤括弧「」・「ご」なしの見出し「応募時の質問」で明記された
  // 質問が、Stage0の見出し抽出（実関数）→Stage1→Application Packetまで具体的な質問文のまま保持されることを確認する。
  const jobId = 'TEST_PKT_RESPONSE_ITEMS_HEADING';
  cleanupApplicationPacketArtifacts(jobId);
  const description = '事務サポート業務をお願いします。\n\n「応募時の質問」\n1.平日日中の対応可否を教えてください。\n2.類似業務の経験有無を教えてください。';
  const stage0ResponseItems = detailScraper.buildFieldStatus(
    detailScraper.extractHeadingSection(description, detailScraper.HEADING_PATTERNS.responseItems), true);
  const detail = detailFixture({
    description, responseItems: stage0ResponseItems,
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  });
  detail.jobId = jobId;
  detail.url = `https://crowdworks.jp/public/jobs/${jobId}`;
  const stage1 = analyzer.analyzeJobDetail(detail);
  saveJobAnalysis(jobId, stage1);
  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('見出し「応募時の質問」（鉤括弧・「ご」なし）で明記された質問が、Application Packetに具体的な質問文として保持される（実案件13392611のパターン）',
    result.built === true
    && result.packet.applicationQuestions.responseItems.status === 'extracted'
    && result.packet.applicationQuestions.responseItems.value.includes('平日日中の対応可否')
    && result.packet.applicationQuestions.responseItems.value.includes('類似業務の経験有無'),
    JSON.stringify(result.packet && result.packet.applicationQuestions.responseItems));
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // 統合確認（実案件13257814のパターン）：見出しには一致しないが「下記の質問にお答えください」という
  // 頻出表現がある場合も、Stage0→Stage1→Application Packetまで質問文の抜粋が保持されることを確認する。
  const jobId = 'TEST_PKT_RESPONSE_ITEMS_SOFT';
  cleanupApplicationPacketArtifacts(jobId);
  const description = '資料作成をお願いします。\n\nご応募の際には、必ず下記の質問にお答えください。\n①活かせる経験を教えてください。\n②想定納期を教えてください。';
  const stage0ResponseItems = detailScraper.buildFieldStatus(
    detailScraper.extractHeadingSection(description, detailScraper.HEADING_PATTERNS.responseItems), true);
  const detail = detailFixture({
    description, responseItems: stage0ResponseItems,
    requiredConditions: { value: null, status: 'requires_analysis', matchedHeading: null, sourceAvailable: true },
  });
  detail.jobId = jobId;
  detail.url = `https://crowdworks.jp/public/jobs/${jobId}`;
  const stage1 = analyzer.analyzeJobDetail(detail);
  saveJobAnalysis(jobId, stage1);
  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('見出し不一致でも頻出表現「下記の質問にお答えください」で明記された質問がApplication Packetに抜粋として保持される（実案件13257814のパターン）',
    result.built === true
    && result.packet.applicationQuestions.responseItems.status === 'requires_ai_analysis'
    && result.packet.applicationQuestions.responseItems.evidenceText.includes('①活かせる経験')
    && result.packet.applicationQuestions.responseItems.evidenceText.includes('②想定納期'),
    JSON.stringify(result.packet && result.packet.applicationQuestions.responseItems));
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // stop案件（応募非推奨）は既存のStage1判定を尊重し、Application Packetを生成しない
  const jobId = 'TEST_PKT_STOP';
  cleanupApplicationPacketArtifacts(jobId);
  const stage1 = makeStage1Analysis(jobId, {
    proposalGenerationAllowed: false,
    recommendation: { value: 'stop', reasons: ['テスト用stop理由'] },
  });
  saveJobAnalysis(jobId, stage1);

  const result = applicationPacketBuilder.buildApplicationPacket(jobId);
  record('stop判定の案件はbuilt=falseになり、Application Packetを生成しない', result.built === false && /stop/.test(result.reason));
  record('stop判定の案件はファイルも保存されない', loadApplicationPacket(jobId) === null);
  cleanupApplicationPacketArtifacts(jobId);
}
{
  // Stage1分析結果が存在しない案件（未取得・未分析）はbuilt=falseで明示的に理由を返す
  const result = applicationPacketBuilder.buildApplicationPacket('TEST_PKT_NO_STAGE1_XYZ');
  record('Stage1分析結果が存在しない場合はbuilt=falseで理由を明示する',
    result.built === false && /Stage1/.test(result.reason));
}
{
  // シナリオ5: 応募候補0件（stage1Resultsが空配列）でも例外を投げず、0件の集計を返す
  const summary = applicationPacketBuilder.buildApplicationPacketsFromStage1Results([]);
  record('応募候補0件（空配列）でも例外を投げず対象0件として処理される',
    summary.targetCount === 0 && summary.builtCount === 0 && summary.results.length === 0);
}
{
  // buildApplicationPacketsFromStage1Results: analyzed=falseの案件・proposalGenerationAllowed=falseの
  // 案件（stop・確認候補等）は対象から除外し、対象になる案件のみパケットを生成する
  const okId = 'TEST_PKT_BATCH_OK';
  const stopId = 'TEST_PKT_BATCH_STOP';
  cleanupApplicationPacketArtifacts(okId);
  cleanupApplicationPacketArtifacts(stopId);
  saveJobAnalysis(okId, makeStage1Analysis(okId));
  saveJobAnalysis(stopId, makeStage1Analysis(stopId, { proposalGenerationAllowed: false, recommendation: { value: 'stop', reasons: ['テスト'] } }));

  const stage1Results = [
    { jobId: okId, analyzed: true, recommendation: 'proceed', proposalGenerationAllowed: true },
    { jobId: stopId, analyzed: true, recommendation: 'stop', proposalGenerationAllowed: false },
    { jobId: 'TEST_PKT_BATCH_SKIPPED', analyzed: false, skipReason: '見送り済み' },
  ];
  const summary = applicationPacketBuilder.buildApplicationPacketsFromStage1Results(stage1Results);
  record('分析対象一覧のうちproposalGenerationAllowed=trueの案件のみが対象件数に含まれる（既存の応募判定を尊重）',
    summary.targetCount === 1 && summary.builtCount === 1);
  record('stop・未分析の案件はApplication Packetを生成しない', loadApplicationPacket(stopId) === null);

  cleanupApplicationPacketArtifacts(okId);
  cleanupApplicationPacketArtifacts(stopId);
}

console.log('\n' + '='.repeat(100));
console.log(`■ 合計: ${pass}/${total} 件合格`);
console.log('='.repeat(100));
console.log(pass === total ? '✅ 全項目合格' : '❌ 不合格項目あり（本番デプロイ不可）');

})();
