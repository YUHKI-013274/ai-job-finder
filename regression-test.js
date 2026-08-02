// Knowledge駆動評価ロジックの回帰テスト（v4：能力辞典フォールバック修正＋確認候補新設）
//
// v1（証拠分離・文脈誤読・動画編集・SNS運用）、v2（証拠5分類）、v3（高単価チャレンジ枠）はそのまま維持し、
// 今回は「能力辞典フォールバックの不具合修正」「確認候補の新設」を追加でテストする。
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
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded } = evaluator.classifyJobs([testJob], {}, {}, {});
  const all = [...nowApply, ...highValueChallenge, ...normalChallenge, ...confirmCandidates, ...holds, ...excluded];
  const result = all[0];
  let bucket;
  if (nowApply.includes(result)) bucket = '📋今すぐ応募';
  else if (highValueChallenge.includes(result)) bucket = '🔥高単価チャレンジ';
  else if (normalChallenge.includes(result)) bucket = '🌱通常チャレンジ';
  else if (confirmCandidates.includes(result)) bucket = '❓確認候補';
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
  console.log(`    理由: ${result.capabilityReason || '-'}`);
  if (result.confirmBeforeApply && result.confirmBeforeApply.length > 0) console.log(`    要確認: ${result.confirmBeforeApply.join('、')}`);
  console.log('');
  return pass;
}

let pass = 0, total = 0;
function record(ok) { total++; if (ok) pass++; }

console.log('='.repeat(100));
console.log('■ 監査で抽出した「応募検討可能」8件の回帰確認（応募候補または確認候補へ戻ることが合格条件）');
console.log('='.repeat(100) + '\n');

const opportunityCases = [
  ['SNSデザイン案件！旅行系Instagramアカウントのフィード投稿デザイナー募集', '旅行系Instagramアカウントのフィード投稿をデザインしていただきます。', '10,000円'],
  ['医療職の"働き方の悩み"に寄り添うフィード投稿を一緒につくりませんか？', '医療職向けのフィード投稿を一緒に制作していただきます。', '10,000円'],
  ['美容×SNSデザイン｜夜勤で頑張る看護師さんに寄り添う投稿制作メンバー募集', '夜勤で働く方に寄り添う投稿制作メンバーを募集します。', '10,000円'],
  ['「夜勤でもキレイでいたい」を届けるInstagramデザイナー募集', 'Instagramデザイナーを募集します。', '10,000円'],
  ['初心者歓迎 簡単な記事作成', '記事作成のお仕事です。1記事3000文字程度。', '5,000円'],
  ['完全在宅 海外動画リサーチャー募集｜YouTube企画を支えるお仕事【継続案件】', '海外動画の企画リサーチをお願いします。継続案件です。', '5,000円'],
  ['コスメ好き歓迎 時短垢抜けメイクInstagram画像制作', 'Instagram画像制作のお仕事です。', '30,000円'],
  ['アウトドア好き歓迎 Instagram投稿デザイナー募集', 'Instagram投稿デザイナーを募集します。', '5,000円'],
];
let opportunityPass = 0;
opportunityCases.forEach(([title, desc, price], i) => {
  const ok = check(`案件${i + 1}`, job(title, desc, price), (bucket) => ['📋今すぐ応募', '🔥高単価チャレンジ', '🌱通常チャレンジ', '❓確認候補'].includes(bucket));
  record(ok);
  if (ok) opportunityPass++;
});
console.log(`→ 応募検討可能8件中 ${opportunityPass}件が除外を免れた\n`);

console.log('='.repeat(100));
console.log('■ 監査で抽出した「判断不能」代表4件の回帰確認（確認候補へ入ることが合格条件）');
console.log('='.repeat(100) + '\n');

const undecidedCases = [
  ['Liver募集！「在宅/フルリモート」', '在宅・フルリモートでのお仕事です。', '要確認'],
  ['コーポレートサイト制作｜継続依頼あり｜20代活躍中', 'コーポレートサイトを制作していただきます。継続依頼あり。', '10,000円'],
  ['システム刷新支援（PM／PMO）', 'システム刷新プロジェクトのPM/PMO支援をお願いします。', '要確認'],
  ['制度商品領域 システム刷新推進PMO支援', 'PMO支援業務をお願いします。', '1,000,000円'],
];
undecidedCases.forEach(([title, desc, price], i) => {
  record(check(`判断不能案件${i + 1}`, job(title, desc, price), (bucket) => bucket === '❓確認候補'));
});

console.log('='.repeat(100));
console.log('■ 明確な除外案件の維持確認（戻ってはいけない）');
console.log('='.repeat(100) + '\n');

record(check('資格必須は戻らない', job('看護師資格保有者限定の医療コンサル案件（高単価）', '看護師資格保有者のみ応募可能です。', '50,000円'), (bucket) => bucket === '🚫除外'));
record(check('動画編集は戻らない', job('【高単価】YouTube動画編集者募集', 'YouTube動画のカット編集をお願いします。', '20,000円'), (bucket) => bucket === '🚫除外'));
record(check('SNS運用代行は戻らない', job('【高単価】Instagram運用スタッフ募集', 'Instagramアカウントの運用をお任せします。', '80,000円'), (bucket) => bucket === '🚫除外'));
record(check('単純作業・アンケートは戻らない', job('簡単アンケートに答えるだけ', 'アンケートに回答していただくだけの簡単なお仕事です。', '1,000円'), (bucket) => bucket === '🚫除外'));
record(check('未使用ツール必須は戻らない', job('Illustrator必須のロゴデザイン案件', 'Illustratorを使用してロゴデザインを作成していただきます。', '10,000円'), (bucket) => bucket === '🚫除外'));

console.log('='.repeat(100));
console.log('■ 能力辞典フォールバックの発動確認');
console.log('='.repeat(100) + '\n');

{
  const testJob = job('SNSデザイン案件！旅行系Instagramアカウントのフィード投稿デザイナー募集', 'デザイナーを募集します。', '10,000円');
  const { result } = runOne(testJob);
  const fired = result.capabilityStatus === '確認候補' && result.capabilityReason && result.capabilityReason.includes('転用可能な能力');
  record(fired);
  console.log(`${fired ? '✅' : '❌'} 能力辞典フォールバックが発動している（capabilityStatus=確認候補、判定理由に転用可能な能力の言及あり）`);
  console.log(`    判定理由: ${result.capabilityReason}\n`);
}

console.log('='.repeat(100));
console.log('■ 確認候補が大量流入していないかの確認（実データ400件サンプル）');
console.log('='.repeat(100) + '\n');
{
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('data/seen_jobs.json', 'utf8'));
  const entries = Object.entries(data).slice(0, 400);
  const jobs400 = entries.map(([id, v]) => ({
    id, title: v.title, description: '', price: '要確認', url: v.url, applicants: null, deadline: null, matchedKeyword: '(サンプル)',
  }));
  const { nowApply, highValueChallenge, normalChallenge, confirmCandidates, holds, excluded } = evaluator.classifyJobs(jobs400, {}, {}, {});
  console.log(`400件サンプル → 今すぐ応募:${nowApply.length} / 高単価チャレンジ:${highValueChallenge.length} / 通常チャレンジ:${normalChallenge.length} / 確認候補:${confirmCandidates.length} / 保留:${holds.length} / 除外:${excluded.length}`);
  const confirmRatio = (confirmCandidates.length / 400 * 100).toFixed(1);
  console.log(`確認候補の比率: ${confirmRatio}%（判断材料: 400件中${confirmCandidates.length}件）\n`);
}

console.log('='.repeat(100));
console.log(`■ 合計: ${pass}/${total} 件合格`);
console.log('='.repeat(100));
console.log(pass === total ? '✅ 全項目合格' : '❌ 不合格項目あり（本番デプロイ不可）');
