// Knowledge駆動評価ロジックの回帰テスト（v5：既出＝履歴化・継続候補・検索範囲拡張）
//
// これまでの修正（証拠分離・動画編集除外・確認候補新設等）は維持しつつ、
// 今回は「既出を除外理由にしない」「継続候補が評価パイプラインへ通る」
// 「台本作成／イラスト制作／AI業務支援の新規検索語が正しく分類される」ことを追加でテストする。
//
// 実行: node regression-test.js

const evaluator = require('./evaluator');
const config = require('./config');

let idCounter = 1;
function job(title, description, price = '3,000円') {
  return {
    id: String(idCounter++),
    title,
    description,
    price,
    url: 'https://crowdworks.jp/public/jobs/' + idCounter,
    applicants: null,
    deadline: null,
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
console.log(`■ 合計: ${pass}/${total} 件合格`);
console.log('='.repeat(100));
console.log(pass === total ? '✅ 全項目合格' : '❌ 不合格項目あり（本番デプロイ不可）');
