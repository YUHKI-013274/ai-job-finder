// Knowledge駆動評価ロジックの回帰テスト（v2：証拠分離・文脈誤読・動画編集・SNS運用のテスト）
//
// 過去に実際に取得された案件タイトル（data/seen_jobs.json）に基づく実例、および
// ユーザー指定のテストケースで、現在のevaluator.js/knowledge-classifier.jsの判定結果を確認する。
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
  const { candidates, growthCandidates, holds, excluded } = evaluator.classifyJobs([testJob], {}, {}, {});
  const all = [...candidates, ...growthCandidates, ...holds, ...excluded];
  const result = all[0];
  let bucket;
  if (candidates.includes(result)) bucket = '📋応募候補';
  else if (growthCandidates.includes(result)) bucket = '🌱成長候補';
  else if (holds.includes(result)) bucket = '⏸保留';
  else bucket = '🚫除外';
  return { bucket, result };
}

function check(label, testJob, expectFn, note) {
  const { bucket, result } = runOne(testJob);
  const pass = expectFn(bucket, result);
  console.log(`${pass ? '✅' : '❌'} ${label}${note ? '  (' + note + ')' : ''}`);
  console.log(`    タイトル: ${testJob.title}`);
  console.log(`    結果: ${bucket} / rank=${result.rank || '-'} / capabilityStatus=${result.capabilityStatus || '-'} / excludeReason=${result.excludeReason || '-'}`);
  if (result.capabilityReason) console.log(`    理由: ${result.capabilityReason}`);
  if (result.decisionSource) console.log(`    根拠: ${result.decisionSource}`);
  console.log('');
  return pass;
}

console.log('='.repeat(100));
console.log('■ 誤判定修正の確認（9項目）');
console.log('='.repeat(100) + '\n');

let pass = 0, total = 0;
const results = [];

function record(ok) { total++; if (ok) pass++; results.push(ok); }

record(check(
  '1. 勉強法バナーに飲食経験が使われない',
  job('【バナー募集】勉強がもっと楽になる！「勉強が楽になるコツ」特集ページ用バナーデザイン募集', '勉強法をテーマにしたバナーをデザインしてください。', '5,000円'),
  (bucket, r) => !r.capabilityReason || !r.capabilityReason.includes('飲食')
));

record(check(
  '2. 山梨旅行Instagramに飲食経験が使われない',
  job('【継続依頼あり】山梨の魅力を紹介するInstagram投稿デザイン依頼！旅行好きの方歓迎', '山梨県の観光地の魅力を伝えるInstagram投稿画像を作成してください。', '10,000円〜30,000円'),
  (bucket, r) => !r.capabilityReason || !r.capabilityReason.includes('飲食')
));

record(check(
  '3. タイ旅行Instagramに飲食経験が使われない',
  job('【継続依頼あり】タイの魅力を紹介するInstagram投稿デザイン依頼！旅行好きの方歓迎', 'タイの観光地の魅力を伝えるInstagram投稿画像を作成してください。', '10,000円〜30,000円'),
  (bucket, r) => !r.capabilityReason || !r.capabilityReason.includes('飲食')
));

record(check(
  '4. レシピ記事では飲食経験とライティング証拠が分離される',
  job('20代独身向けレシピ・料理ジャンルのライター募集｜継続依頼あり・サポート体制あり', '料理・レシピに関する記事を執筆していただきます。', '5,000円'),
  (bucket, r) => r.capabilityReason
    && r.capabilityReason.includes('テーマ理解として飲食業22年')
    && (r.capabilityReason.includes('AIライティング5記事') || r.capabilityReason.includes('制作実績として'))
    && r.genre !== '飲食・店舗運営に関する企画・コンテンツ' // 主タスクはライティングとして分類されるべき
));

record(check(
  '5. 「マニュアル完備」の動画編集案件がマニュアル作成に分類されない',
  job('【5本15,000円～/マニュアル完備/Vtuber好き大歓迎！】大手VTuberの切り抜きYouTubeの動画編集者募集！', 'YouTube動画の切り抜き編集をお願いします。マニュアル完備なので未経験でも安心です。', '15,000円'),
  (bucket, r) => bucket === '🚫除外' && r.excludeReason === '対応不可（Knowledge判定）' && r.capabilityReason && r.capabilityReason.includes('動画編集')
));

const videoJobs = [
  job('【継続依頼】YouTube動画編集スタッフ募集｜テロップ・BGM・カット編集', 'テロップ入れ・BGM挿入・カット編集をお願いします。', '5,000円'),
  job('【5本15,000円～/マニュアル完備】大手VTuberの切り抜きYouTubeの動画編集者募集！', 'YouTube動画の切り抜き編集。', '15,000円'),
  job('【テスト案件】3分程度の動画編集｜継続依頼あり', '3分程度の動画編集をお願いします。', '1,100円'),
  job('【長期・昇給確約】ゴルフ系YouTube動画編集！1本4000円〜★マニュアル完備', 'ゴルフ動画の編集をお願いします。', '4,000円'),
];
let videoExcluded = 0;
for (const vj of videoJobs) {
  const { bucket } = runOne(vj);
  if (bucket === '🚫除外') videoExcluded++;
}
record(check(
  '6. 動画編集案件4件が応募候補・成長候補から外れる（' + videoExcluded + '/4件が除外）',
  videoJobs[0],
  () => videoExcluded === 4
));

record(check(
  '7. 動画シナリオ作成はライティングとして評価される',
  job('動画シナリオ作成のお仕事｜YouTube台本作成', '商品紹介動画のシナリオ・台本を作成していただきます。', '5,000円'),
  (bucket, r) => bucket !== '🚫除外' && r.capabilityStatus !== '対応不可'
));

record(check(
  '8. 「運用スタッフ募集」がSNS運用系として判定される',
  job('【観光スポット】旅行Instagram運用スタッフ募集', 'Instagramアカウントの運用スタッフを募集します。', '5,000円'),
  (bucket, r) => bucket === '🚫除外' && r.excludeReason === 'SNS運用代行'
));

record(check(
  '9. Instagram画像制作はSNS運用代行として除外されない',
  job('Instagram投稿デザイン募集｜カフェ情報アカウント', 'Instagram投稿用の画像を1枚制作してください。単発制作です。', '5,000円'),
  (bucket, r) => r.excludeReason !== 'SNS運用代行'
));

console.log('='.repeat(100));
console.log('■ 維持すべき評価の確認（7項目）');
console.log('='.repeat(100) + '\n');

record(check(
  '維持1. BtoB資料作成',
  job('BtoB向けサービス紹介資料の作成', '企業向けサービスの魅力を伝えるサービス紹介資料を作成していただきます。', '8,000円'),
  (bucket) => bucket === '📋応募候補' || bucket === '🌱成長候補'
));

record(check(
  '維持2. PowerPoint資料',
  job('【PowerPoint資料デザイン】サービス紹介資料のデザインリニューアル', 'PowerPointで提案資料のデザインをリニューアルしていただきます。継続依頼あり。', '15,000円'),
  (bucket) => bucket === '📋応募候補' || bucket === '🌱成長候補'
));

record(check(
  '維持3. マニュアル作成',
  job('社内向け業務マニュアルの作成', '社内向けの業務マニュアルを作成していただきます。継続案件になる可能性あり。', '6,000円'),
  (bucket) => bucket === '📋応募候補' || bucket === '🌱成長候補'
));

record(check(
  '維持4. AIライティング',
  job('AIツールを活用した業務効率化に関する記事作成', 'ChatGPTを使った業務効率化について、初回800文字の記事を作成してください。継続あり。', '2,000円'),
  (bucket) => bucket === '📋応募候補' || bucket === '🌱成長候補'
));

record(check(
  '維持5. 一般ライティング',
  job('【急募】暮らし・インテリアに関する記事制作', 'SEO記事の執筆をお願いします。1記事3000文字程度。', '3,000円'),
  (bucket) => bucket === '📋応募候補' || bucket === '🌱成長候補'
));

record(check(
  '維持6. Canva画像制作',
  job('【Canva◎】「作業カフェ」の魅力を伝えるSNSバナーデザイン募集', 'Canvaを使ってSNS用バナーを1枚作成してください。単発制作で、構成・ターゲット・目的を意識したデザインをお願いします。', '2,500円'),
  (bucket) => bucket === '📋応募候補' || bucket === '🌱成長候補'
));

record(check(
  '維持7. 飲食関連案件',
  job('飲食店の新メニュー紹介コンテンツ作成', '飲食店の新メニューを紹介する記事を作成してください。', '4,000円'),
  (bucket, r) => (bucket === '📋応募候補' || bucket === '🌱成長候補') && r.capabilityReason && r.capabilityReason.includes('飲食')
));

console.log('='.repeat(100));
console.log(`■ 合計: ${pass}/${total} 件合格`);
console.log('='.repeat(100));
console.log(pass === total ? '✅ 全項目合格' : '❌ 不合格項目あり（本番デプロイ不可）');
