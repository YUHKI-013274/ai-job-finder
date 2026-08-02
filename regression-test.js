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
console.log(`■ 合計: ${pass}/${total} 件合格`);
console.log('='.repeat(100));
console.log(pass === total ? '✅ 全項目合格' : '❌ 不合格項目あり（本番デプロイ不可）');
