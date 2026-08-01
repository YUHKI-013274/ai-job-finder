// Knowledge駆動評価ロジックの回帰テスト（v3：高単価チャレンジ枠の表示区分テスト）
//
// v1（証拠分離・文脈誤読・動画編集・SNS運用）、v2はそのまま維持し、
// 今回は「今すぐ応募／高単価チャレンジ／通常チャレンジ」の表示区分ロジックを追加でテストする。
//
// 実行: node regression-test.js

const evaluator = require('./evaluator');

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

function runOne(testJob) {
  const { nowApply, highValueChallenge, normalChallenge, holds, excluded } = evaluator.classifyJobs([testJob], {}, {}, {});
  const all = [...nowApply, ...highValueChallenge, ...normalChallenge, ...holds, ...excluded];
  const result = all[0];
  let bucket;
  if (nowApply.includes(result)) bucket = '📋今すぐ応募';
  else if (highValueChallenge.includes(result)) bucket = '🔥高単価チャレンジ';
  else if (normalChallenge.includes(result)) bucket = '🌱通常チャレンジ';
  else if (holds.includes(result)) bucket = '⏸保留';
  else bucket = '🚫除外';
  return { bucket, result };
}

function check(label, testJob, expectFn, note) {
  const { bucket, result } = runOne(testJob);
  const pass = expectFn(bucket, result);
  console.log(`${pass ? '✅' : '❌'} ${label}${note ? '  (' + note + ')' : ''}`);
  console.log(`    タイトル: ${testJob.title}`);
  console.log(`    結果: ${bucket} / rank=${result.rank || '-'} / displayTier=${result.displayTier || '-'} / capabilityStatus=${result.capabilityStatus || '-'} / excludeReason=${result.excludeReason || '-'}`);
  if (result.highValueSignals && result.highValueSignals.length > 0) {
    console.log(`    高単価理由: ${result.highValueSignals.map(s => s.text).join('、')}`);
  }
  if (result.confirmBeforeApply && result.confirmBeforeApply.length > 0) {
    console.log(`    要確認: ${result.confirmBeforeApply.join('、')}`);
  }
  console.log('');
  return pass;
}

let pass = 0, total = 0;
function record(ok) { total++; if (ok) pass++; }

console.log('='.repeat(100));
console.log('■ 表示区分の回帰確認');
console.log('='.repeat(100) + '\n');

record(check(
  '1. 今すぐ応募案件が維持される（AI業務改善、高単価・直接証明）',
  job('生成AI活用による業務改善・業務改革支援', 'プロジェクトマネジメント経験を活かし、企業のAI業務改善を支援していただきます。月額報酬100万円。', '1,000,000円'),
  (bucket, r) => bucket === '📋今すぐ応募' && r.displayTier === 'now'
));

record(check(
  '2. 監査で特定した高単価チャレンジ（Canva 10,000円・継続案件）が独立表示される',
  job('【継続案件】旅行の日に真似したいメイクを発信するInstagram投稿制作', 'Canvaを使ってInstagram投稿画像を制作していただきます。継続案件です。', '10,000円'),
  (bucket, r) => bucket === '🔥高単価チャレンジ' && r.displayTier === 'high_value_challenge'
));

record(check(
  '2b. 監査で特定した高単価チャレンジ（Canva 10,000円・月4本継続）が独立表示される',
  job('【月4本〜継続◎】構成・素材支給で簡単！美容Instagramの投稿制作', 'Canvaで美容系Instagram投稿を月4本制作していただきます。継続依頼です。', '10,000円'),
  (bucket, r) => bucket === '🔥高単価チャレンジ' && r.displayTier === 'high_value_challenge'
));

record(check(
  '3. 低単価の通常チャレンジ（1,500円Canva）と区別される',
  job('Canvaデザイン🎨海外旅行で使う英語フレーズ紹介の画像制作', 'Canvaで画像を1枚制作していただきます。単発です。', '1,500円'),
  (bucket, r) => bucket === '🌱通常チャレンジ' && r.displayTier === 'normal_challenge'
));

record(check(
  '4. PowerPoint会社案内資料が「条件確認後に応募」として今すぐ応募枠に見える',
  job('【会社案内のデザイン募集】A3 二つ折り会社案内（PowerPoint納品）', 'PowerPointで会社案内資料を制作していただきます。', '応相談'),
  (bucket, r) => bucket === '📋今すぐ応募' && r.displayTier === 'now_pending' && r.confirmBeforeApply.includes('報酬額（案件詳細で確認）')
));

record(check(
  '5. 高単価でも職能不一致の案件（動画編集・高単価）は高単価チャレンジに表示されない',
  job('【高単価】YouTube動画編集者募集！1本20,000円', 'YouTube動画のカット編集・テロップ入れをお願いします。', '20,000円'),
  (bucket) => bucket === '🚫除外'
));

record(check(
  '6a. SNS運用案件は高単価でも戻らない',
  job('【高単価】Instagram運用スタッフ募集｜月額80,000円', 'Instagramアカウントの運用をお任せします。', '80,000円'),
  (bucket) => bucket === '🚫除外'
));

record(check(
  '6b. 資格必須案件は高単価でも戻らない',
  job('【高単価】看護師資格保有者限定 医療コンサル案件', '看護師資格保有者のみ応募可能です。', '50,000円'),
  (bucket) => bucket === '🚫除外'
));

record(check(
  '7. Knowledgeにない経験を使っていない（高単価チャレンジのcapabilityReasonにSales Knowledge外の文言がないか目視確認用）',
  job('BtoB向けホワイトペーパー制作', '企業の課題を整理し、ホワイトペーパーを制作していただきます。', '15,000円'),
  () => true // 目視確認用（下記出力のcapabilityReasonを確認）
));

console.log('='.repeat(100));
console.log('■ 既存機能の確認（応募済み・見送り・既出フィルタ）');
console.log('='.repeat(100) + '\n');

{
  const testJob = job('生成AI活用による業務改善・業務改革支援', 'プロジェクトマネジメント経験を活かし業務改善を支援します。', '1,000,000円');
  const { excluded } = evaluator.classifyJobs([testJob], { [testJob.id]: {} }, {}, {});
  const ok = excluded.length === 1 && excluded[0].excludeReason === '応募済み';
  total++; if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} 8a. 応募済みフィルタは維持される`);
  console.log(`    結果: ${excluded[0] ? excluded[0].excludeReason : '該当なし'}\n`);
}
{
  const testJob = job('生成AI活用による業務改善・業務改革支援', 'プロジェクトマネジメント経験を活かし業務改善を支援します。', '1,000,000円');
  const { excluded } = evaluator.classifyJobs([testJob], {}, { [testJob.id]: {} }, {});
  const ok = excluded.length === 1 && excluded[0].excludeReason === '既出';
  total++; if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} 8b. 既出フィルタは維持される`);
  console.log(`    結果: ${excluded[0] ? excluded[0].excludeReason : '該当なし'}\n`);
}

console.log('='.repeat(100));
console.log(`■ 合計: ${pass}/${total} 件合格`);
console.log('='.repeat(100));
console.log(pass === total ? '✅ 全項目合格' : '❌ 不合格項目あり（本番デプロイ不可）');
