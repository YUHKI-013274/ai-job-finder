// 将来の提供価値（4領域）を判断する追加軸。案件の分類（今応募／要確認／育成候補／対象外）は変えず、
// 各区分の中の「並び順・補充順」にだけ反映する。①〜④の案件を除外はしない。
//
// 最上位目的：「自立した大人を増やす」（クライアントが自分の軸を見つけ、価値を形にし、自分で事業を動かせる状態を支援する）
//   ① 自分の軸を見つける支援（自己理解・コーチング）
//   ② 価値を形にする支援（LP・フォーム・商品設計・資料制作）   ← 現在、最も重点的に経験・実績を蓄積する領域
//   ③ 自分で事業を動かせるようにする支援（収支管理・事業戦略・課題解決）
//   ④ AIで実行力を高める支援（AI活用・研修・仕組み化）
// 優先度（小さいほど優先）:
//   1 … ②に直結し、収益も見込める案件
//   2 … ②に直結し、将来のサービスに活用できる実績・経験を獲得できる案件
//   3 … ③④に関連し、収益性・将来性が高い案件
//   4 … 上記以外（除外ではない）
// 得られる経験（制作物そのものだけでなく評価する）:
//   課題理解／価値の明確化／制作物への落とし込み／成果確認・改善
// 既存のKnowledge（主戦場・成長領域・将来事業直結の分類）は変更しない。ここは追加の判断軸であり、
// 語の表はコード側の設定。Knowledgeの正規データではない。

const AREAS = {
  shape: {
    no: '②', label: '価値を形にする',
    patterns: ['LP', 'ランディングページ', 'セールスレター', 'ステップメール', '申込フォーム', 'フォーム制作', 'フォーム作成', 'フォーム設計',
      '商品設計', 'サービス設計', '商品説明', 'サービス紹介', '商品紹介', '営業資料', '提案資料', '提案書', '企画書', '会社案内', 'パンフレット',
      'カタログ', 'メニュー表', '価格表', 'ホワイトペーパー', 'サービス資料', 'スライド', '資料作成', '資料の作成', '資料制作', 'PowerPoint', 'パワーポイント', 'ブランディング', 'ロゴ', 'バナー', 'コンセプト設計'],
  },
  axis: {
    no: '①', label: '自分の軸を見つける',
    patterns: ['コーチング', '自己理解', '自己分析', 'キャリア相談', 'キャリアコンサル', 'カウンセリング', 'ライフプラン', '強みの発見', '自分軸', 'ワークショップ', '適性診断'],
  },
  run: {
    no: '③', label: '事業を動かす',
    patterns: ['収支管理', '事業計画', '事業戦略', '経営', 'KPI', '課題解決', '業務改善', '売上', '予算管理', '経理', 'マーケティング戦略',
      '事業開発', '新規事業', '集客施策', 'データ分析', '数値管理', '進捗管理', 'プロジェクト管理'],
  },
  ai: {
    no: '④', label: 'AIで実行力を高める',
    // 「AIを使って記事を書く」ではなく、AIの導入・研修・仕組み化を提供する案件を指す（ツール名だけでは数えない）
    patterns: ['AI導入', 'AI研修', 'AI業務', 'AIコンサル', 'GPTs作成', 'GPT作成', 'プロンプト設計', '業務自動化', '自動化', '仕組み化', 'RPA', 'Dify', 'ナレッジ設計'],
  },
};
const ADMIN_ROLE_RE = /(事務|アシスタント|秘書|サポートスタッフ|運営サポート|代行|申込管理)/;
// 制作物そのものが主題であることを示す語（これらがタイトルにあれば、事務・アシスタント職でも②と認める）
const SHAPE_STRONG = ['LP', 'ランディングページ', 'セールスレター', 'ステップメール', '営業資料', '提案資料', '提案書', '企画書', '会社案内',
  'パンフレット', 'ホワイトペーパー', 'ロゴ', 'バナー', 'ブランディング', 'メニュー表', '価格表', 'カタログ', 'コンセプト設計'];
// Knowledgeのカテゴリー（matchedCategory.id）が示す領域の補助点（本文の語が少ない案件の補助）
const CATEGORY_HINT = {
  proposal_document: { shape: 2 }, whitepaper_service: { shape: 2 }, canva_design: { shape: 2 }, sns_single_image: { shape: 1 },
  hospitality_content: { shape: 1 }, btob_writing: { shape: 1 }, seo_article: { shape: 1 },
  business_improvement: { run: 2 }, manual_training: { ai: 1 }, ai_business: { ai: 2 },
};
// 「AI活用OK」のような募集文の定型句は、④の領域を示す語として数えない
const AI_FLUFF_RE = /AI(?:活用|ツール|使用|利用)\s*(?:OK|ok|可|歓迎|推奨|大歓迎)|AI活用\s*[◎◯○]/g;

// 得られる経験（本文の語から判断。制作物そのものだけでなく、目的・価値・成果に関わるか）
const EXPERIENCE = [
  { id: 'understand', label: '課題・目的の理解', re: /(ヒアリング|課題|目的|背景|ご要望|要件|お悩み|現状把握)/ },
  { id: 'clarify', label: '商品・サービスの価値の明確化', re: /(強み|魅力|特長|ターゲット|訴求|差別化|コンセプト|ベネフィット|ペルソナ|価値)/ },
  { id: 'shape', label: '価値の制作物への落とし込み', re: /(制作|作成|デザイン|執筆|構成|設計|レイアウト|資料化)/ },
  { id: 'improve', label: '成果確認・改善', re: /(改善|効果測定|成果|検証|フィードバック|PDCA|分析|修正対応|継続的に|アクセス解析)/ },
];

function countHits(text, patterns) {
  const t = String(text || '');
  return patterns.filter(p => t.includes(p)).length;
}

// title/description/categoryId から領域と経験を判定する（副作用なし）
function detectValueAxis(title, description, categoryId = null) {
  const t = String(title || '');
  const d = String(description || '').replace(AI_FLUFF_RE, '');
  const head = d.slice(0, 800);
  const scores = {};
  const evidence = {};
  for (const [key, def] of Object.entries(AREAS)) {
    // タイトルの語は重く（3点）、本文先頭の語は1点。カテゴリーの示唆は補助（最大1点）で、本文・タイトルの語が
    // 1つも無い場合は加点しない（カテゴリーだけで領域を決めない）
    let titleHits = countHits(t.replace(AI_FLUFF_RE, ''), def.patterns);
    let bodyHits = countHits(head, def.patterns);
    // 事務・アシスタント職の募集では、「資料作成」「申込フォーム（の管理）」は業務の一部にすぎない。
    // ②（価値を形にする）と認めるのは、制作物が主題であることを示す語がタイトルにある場合だけにする。
    if (key === 'shape' && ADMIN_ROLE_RE.test(t)) {
      titleHits = countHits(t, SHAPE_STRONG);
      bodyHits = 0;
    }
    const textScore = titleHits * 3 + bodyHits;
    const hint = textScore >= 1 ? Math.min(1, (CATEGORY_HINT[categoryId] || {})[key] || 0) : 0;
    scores[key] = textScore + hint;
    evidence[key] = { titleHits, bodyHits };
  }
  // 領域と認めるのは、タイトルに語がある、または本文に2語以上ある場合（定型業務の中の「資料作成」1語では②としない）
  const order = ['shape', 'ai', 'run', 'axis']; // 同点のときの優先（②→④→③→①）
  let best = null;
  for (const key of order) {
    const ev = evidence[key];
    if (scores[key] >= 2 && (ev.titleHits >= 1 || ev.bodyHits >= 2) && (best === null || scores[key] > scores[best])) best = key;
  }

  const text = `${t}\n${d}`;
  const experience = EXPERIENCE.filter(e => e.re.test(text)).map(e => e.id);
  return {
    area: best,
    areaNo: best ? AREAS[best].no : null,
    areaLabel: best ? AREAS[best].label : null,
    scores,
    experience,
    experienceLabels: EXPERIENCE.filter(e => experience.includes(e.id)).map(e => e.label),
    experienceCount: experience.length,
  };
}

// 優先度の決定。収益の見込みは評価器の既存指標（報酬・継続性・長期資産性）と、報酬条件の確定状況から判断する。
function valueTier(va, job, signals) {
  if (!va || !va.area) return { tier: 4, label: '領域を特定できない（除外ではない）' };
  const detailUnknown = !!(signals && signals.priceDetail && signals.priceDetail.unknown);
  const priceKnown = !job.priceUnverified && !detailUnknown;
  const revenueOk = priceKnown && ((job.priceScore || 0) >= 3 || (job.continuityScore || 0) >= 5 || (job.priceYen || 0) >= 3000);
  const strongFuture = revenueOk && ((job.priceScore || 0) >= 4 || (job.continuityScore || 0) >= 5 || (job.longTermAssetScore || 0) >= 4);

  if (va.area === 'shape') {
    if (revenueOk) return { tier: 1, label: '優先度1：②価値を形にする × 収益が見込める' };
    if (va.experienceCount >= 3) return { tier: 2, label: '優先度2：②価値を形にする × 将来のサービスに活かせる実績・経験が得られる' };
    return { tier: 4, label: '②だが収益・得られる経験とも限定的（除外ではない）' };
  }
  if ((va.area === 'run' || va.area === 'ai') && strongFuture) {
    return { tier: 3, label: `優先度3：${va.areaNo}${va.areaLabel} × 収益性・将来性が高い` };
  }
  return { tier: 4, label: `${va.areaNo}${va.areaLabel}（優先度は低いが除外しない）` };
}

module.exports = { AREAS, EXPERIENCE, detectValueAxis, valueTier };
