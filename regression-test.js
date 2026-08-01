// Knowledge駆動評価ロジックの回帰テスト（新旧比較）
//
// 過去に実際に取得された案件タイトル（data/seen_jobs.json）に基づく実例、および
// ユーザー指定の20テストカテゴリを代表する事例（実在しない具体的な報酬・条件は
// テスト用に合成したもの、と明記）で、旧evaluator.js（git HEAD）と新evaluator.js（現在の変更）の
// 判定結果を比較する。
//
// 実行: node regression-test.js

const oldEvaluator = require('./evaluator.old');
const newEvaluator = require('./evaluator');

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

// ===== 改善すべきケース（本人が見れば応募可能と判断できるはずの案件） =====
// タイトルは data/seen_jobs.json の実データに基づくものを優先使用。報酬・本文詳細はテスト用に合成。
const IMPROVE_CASES = [
  {
    label: '1. 一般ライティング案件',
    note: 'タイトルは実データ由来（data/seen_jobs.json）',
    job: job(
      '【急募】暮らし・インテリアに関する記事制作',
      'SEO記事の執筆をお願いします。1記事3000文字程度。読者目線でわかりやすい記事を作成してください。',
      '3,000円'
    ),
  },
  {
    label: '2. 体験談・コラム案件',
    note: 'タイトルは実データ由来',
    job: job(
      '写真映えカフェ巡り旅の記事ライター募集',
      '体験談をもとにしたコラム記事を執筆していただきます。未経験歓迎。1500文字程度。',
      '1,500円'
    ),
  },
  {
    label: '3. AI関連ライティング',
    note: 'タイトルは実データ由来',
    job: job(
      'AIツールを活用した業務効率化に関する記事作成',
      'ChatGPTを使った業務効率化について、初回800文字の記事を作成してください。継続あり。',
      '2,000円'
    ),
  },
  {
    label: '4. BtoB資料作成',
    note: '合成事例',
    job: job(
      'BtoB向けサービス紹介資料の作成',
      '企業向けサービスの魅力を伝えるサービス紹介資料を作成していただきます。',
      '8,000円'
    ),
  },
  {
    label: '5. PowerPoint提案資料',
    note: 'タイトルは実データ由来',
    job: job(
      '【PowerPoint資料デザイン】サービス紹介資料のデザインリニューアル',
      'PowerPointで提案資料のデザインをリニューアルしていただきます。継続依頼あり。',
      '15,000円'
    ),
  },
  {
    label: '6. マニュアル作成',
    note: '合成事例',
    job: job(
      '社内向け業務マニュアルの作成',
      '社内向けの業務マニュアルを作成していただきます。継続案件になる可能性あり。',
      '6,000円'
    ),
  },
  {
    label: '7. Canva画像制作',
    note: 'タイトルは実データ由来',
    job: job(
      '【Canva◎】「作業カフェ」の魅力を伝えるSNSバナーデザイン募集',
      'Canvaを使ってSNS用バナーを1枚作成してください。単発制作で、構成・ターゲット・目的を意識したデザインをお願いします。',
      '2,500円'
    ),
  },
  {
    label: '8. 飲食・店舗関連案件',
    note: '合成事例',
    job: job(
      '飲食店の新メニュー紹介コンテンツ作成',
      '飲食店の新メニューを紹介する記事を作成してください。',
      '4,000円'
    ),
  },
  {
    label: '9. 業務改善案件',
    note: '合成事例',
    job: job(
      '中小企業向け業務改善提案資料の作成',
      '現場の課題を整理し、業務改善の提案資料を作成していただきます。',
      '10,000円'
    ),
  },
  {
    label: '10. 直接実績はないが転用能力で応募可能な案件（ホワイトペーパー）',
    note: '合成事例',
    job: job(
      'ホワイトペーパー制作のお仕事',
      'BtoB向けのホワイトペーパーを作成していただきます。同一実績は問いません。',
      '7,000円'
    ),
  },
];

// ===== 維持すべき除外（引き続き対応不可・除外であるべき案件） =====
const KEEP_EXCLUDED_CASES = [
  {
    label: '1. 看護師資格必須',
    job: job('【看護師資格保有者限定】医療系記事の執筆', '看護師資格保有者のみ募集。医療記事を執筆していただきます。', '5,000円'),
  },
  {
    label: '2. 補助金・助成金申請代行',
    job: job('補助金申請全般を代行していただける方', '補助金・助成金の申請代行をお願いします。', '応相談'),
  },
  {
    label: '3. 契約書・法務文書',
    job: job('株主間契約書の修正', '契約書の修正をお願いします。法務知識が必要です。', '10,000円'),
  },
  {
    label: '4. Illustrator必須',
    job: job('A1ポスター・A4チラシをIllustratorで仕上げ', 'Illustrator必須です。印刷用データへ仕上げていただける方を募集。', '5,000円'),
  },
  {
    label: '5. SNS運用代行',
    job: job('SNSアカウント運用メンバー募集', 'Instagramアカウントの投稿管理・コメント対応・フォロワー増加施策を継続的に行っていただきます。', '30,000円'),
  },
  {
    label: '6. 営業紹介パートナー',
    job: job('【完全成果報酬】AI・システム開発案件の営業・紹介パートナー募集', '紹介パートナーとして成果報酬型で契約を紹介してください。', '成果報酬'),
  },
  {
    label: '7. 動画視聴・アンケートなどの単純作業',
    job: job('動画編集についてのアンケートに答えてください', 'アンケートに回答するだけのお仕事です。', '500円'),
  },
  {
    label: '8a. 出社必須',
    job: job('オフィス勤務での事務スタッフ募集', '出社必須です。オフィス勤務、週40時間勤務。', '時給1,200円'),
  },
  {
    label: '8b. 属性不一致（性別限定）',
    job: job('【女性限定】音声作品(シチュエーションボイス)の収録', '女性限定の募集です。', '3,000円'),
  },
  {
    label: '9. 極端な低単価',
    job: job('【1件3円】商品情報入力のお仕事', '1件につき3円のリスト入力作業です。', '要確認'),
  },
  {
    label: '10. 高額購入・勧誘リスク',
    job: job('在宅で簡単に稼げる副業紹介', '初期費用が必要です。教材購入後にセミナー参加をお願いします。', '応相談'),
  },
  {
    label: '11.（追加検証）不動産関連AI業務改善は非希望領域として除外されるべき',
    note: 'タイトルは実データ由来。AI業務改善パターンに一致するが、Sales Knowledge 5-4により不動産業界は使用禁止領域',
    job: job(
      '不動産管理会社向けAI業務効率化サービスの立ち上げメンバー募集',
      '不動産管理会社向けのAI業務効率化サービスを立ち上げるメンバーを募集します。不動産×AIの経験者優遇。',
      '応相談'
    ),
  },
];

function runOne(evaluator, testJob) {
  const { candidates, growthCandidates, holds, excluded } = evaluator.classifyJobs([testJob], {}, {}, {});
  const all = [...candidates, ...growthCandidates, ...holds, ...excluded];
  const result = all[0];
  let bucket;
  if (candidates.includes(result)) bucket = '📋応募候補';
  else if (growthCandidates.includes(result)) bucket = '🌱成長候補';
  else if (holds.includes(result)) bucket = '⏸保留';
  else bucket = '🚫除外';
  return {
    bucket,
    rank: result.rank || '-',
    excludeReason: result.excludeReason || '',
    capabilityStatus: result.capabilityStatus || '(旧ロジックにはフィールドなし)',
  };
}

function printSection(title, cases) {
  console.log('\n' + '='.repeat(100));
  console.log(title);
  console.log('='.repeat(100));
  for (const c of cases) {
    const oldR = runOne(oldEvaluator, { ...c.job });
    const newR = runOne(newEvaluator, { ...c.job });
    console.log(`\n[${c.label}]${c.note ? '  (' + c.note + ')' : ''}`);
    console.log(`  タイトル: ${c.job.title}`);
    console.log(`  旧: ${oldR.bucket} / rank=${oldR.rank} / excludeReason=${oldR.excludeReason || '-'}`);
    console.log(`  新: ${newR.bucket} / rank=${newR.rank} / excludeReason=${newR.excludeReason || '-'} / capabilityStatus=${newR.capabilityStatus}`);
  }
}

printSection('■ 改善すべきケース（新ロジックで見送り・保留から脱すべき案件）', IMPROVE_CASES);
printSection('■ 維持すべき除外（新ロジックでも引き続き対応不可・除外であるべき案件）', KEEP_EXCLUDED_CASES);

// ===== 合格基準の自動判定 =====
console.log('\n' + '='.repeat(100));
console.log('■ 合格基準チェック');
console.log('='.repeat(100));

let improvePass = 0;
const improveFails = [];
for (const c of IMPROVE_CASES) {
  const newR = runOne(newEvaluator, { ...c.job });
  const isGoodBucket = newR.bucket === '📋応募候補' || newR.bucket === '🌱成長候補';
  if (isGoodBucket) improvePass++;
  else improveFails.push(`${c.label} → ${newR.bucket}（excludeReason: ${newR.excludeReason}）`);
}
console.log(`改善すべきケース: ${improvePass}/${IMPROVE_CASES.length} 件が応募候補または成長候補へ`);
if (improveFails.length > 0) {
  console.log('  未改善:');
  improveFails.forEach(f => console.log('   - ' + f));
}

let keepPass = 0;
const keepFails = [];
for (const c of KEEP_EXCLUDED_CASES) {
  const newR = runOne(newEvaluator, { ...c.job });
  const isExcluded = newR.bucket === '🚫除外';
  if (isExcluded) keepPass++;
  else keepFails.push(`${c.label} → ${newR.bucket}（rank: ${newR.rank}）`);
}
console.log(`維持すべき除外: ${keepPass}/${KEEP_EXCLUDED_CASES.length} 件が引き続き除外`);
if (keepFails.length > 0) {
  console.log('  除外されなかったもの:');
  keepFails.forEach(f => console.log('   - ' + f));
}

// Bランクが0件に固定されないかの確認（改善ケース全体をまとめて評価）
const allImproveJobs = IMPROVE_CASES.map(c => ({ ...c.job }));
const { candidates, growthCandidates } = newEvaluator.classifyJobs(allImproveJobs, {}, {}, {});
console.log(`\n改善すべきケース全体をまとめて評価: 応募候補${candidates.length}件 / 成長候補${growthCandidates.length}件`);

console.log('\n' + '='.repeat(100));
console.log(improvePass === IMPROVE_CASES.length && keepPass === KEEP_EXCLUDED_CASES.length
  ? '✅ 合格基準を満たしています'
  : '❌ 合格基準を満たしていません（本番デプロイ不可）');
console.log('='.repeat(100));
