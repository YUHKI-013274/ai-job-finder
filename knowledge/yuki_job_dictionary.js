// 案件辞典・価値変換辞典・使用禁止表現（構造化データ）— Stage1用
//
// 生成元（このファイルはSales Knowledgeからの抜粋・構造化であり、Knowledge本体は変更しない）:
//   knowledge/yuki_sales_knowledge_v1.md（Version 1.0, 2026-07-26）
//   - 第6章「案件辞典」（クライアントの目的・必要能力・採用時の不安・見せるべき経験・避けるべき表現）
//   - 第7章「価値変換辞典」（経験・能力→クライアントへの価値の変換表）
//   - 第9章「使用禁止・要確認情報」（誇張になる表現、使用禁止の証拠）
//
// keyは knowledge/yuki_profile.js の TASK_CATEGORIES と同じ id を使い、案件分析で
// classifyCapability() が返す matchedCategory.id からそのまま引ける形にする。
// 案件辞典・価値変換辞典の本文はSales Knowledgeの記載をそのまま転記したものであり、
// Stage1のルールベース処理はこれを「参照」するだけで、新しい文言は生成しない。

// ===== 第6章 案件辞典（10カテゴリー全件） =====
const JOB_DICTIONARY = {
  proposal_document: {
    section: 'Sales Knowledge 6-1',
    clientPurpose: '複雑な情報や課題を整理し、読み手が理解・判断・行動できる資料を作る',
    hiringConcerns: '見た目だけで内容を理解していない、修正意図を汲めない、資料が読みにくい',
    winProbability: '高い。主戦場',
    recommendedExperience: '経営層・取引先へのプレゼン・資料作成3年、BtoB業務改善提案3年、PowerPoint提案資料、課題整理、事業部統括',
    avoidExpressions: ['デザインを得意としています', '豊富な資料制作実績'],
    properFraming: '現場課題を整理し、相手が判断しやすい構成へ落とし込んだ経験を中心にする',
  },
  manual_training: {
    section: 'Sales Knowledge 6-7',
    clientPurpose: '担当者によるばらつきを減らし、初めての人でも実行できる状態を作る',
    hiringConcerns: '説明が難しい、現場で使われない、更新しにくい',
    winProbability: '高い。主戦場',
    recommendedExperience: '複数拠点の数値管理・人材育成10年、店長20名以上の育成、新規事業・店舗立ち上げ8年、提案資料',
    avoidExpressions: ['研修講師として豊富な登壇実績'],
    properFraming: '教える側ではなく、使う人が理解し行動できる順序を設計する',
  },
  business_improvement: {
    section: 'Sales Knowledge 6-6',
    clientPurpose: '非効率、属人化、ミス、停滞を減らし、業務を進めやすくする',
    hiringConcerns: '一般論、現場で実行できない、提案後に運用できない',
    winProbability: '高い。主戦場',
    recommendedExperience: 'プロジェクトマネジメント6年、事業部統括3年、BtoB業務改善提案3年、複数拠点管理10年、関係者調整・進行管理6年、AI業務改善・仕組み設計',
    avoidExpressions: ['あらゆる業界の業務改善に対応', 'コンサル実績多数'],
    properFraming: '現場の制約を踏まえ、実行順序と運用まで具体化できる',
  },
  ai_business: {
    section: 'Sales Knowledge 6-5',
    clientPurpose: 'AIを使って、判断・情報検索・反復作業・業務の手戻りを減らす',
    hiringConcerns: 'AI導入が目的化する、現場で使えない、保守できない、機密情報の扱い',
    winProbability: '中〜高。小規模な業務整理・仕組み化は主戦場',
    recommendedExperience: 'AI業務改善・仕組み設計、GPTs、Dify、Claude Code Knowledge DB、朝礼自動化、プロジェクトマネジメント6年',
    avoidExpressions: ['AIシステム開発の専門家', '企業導入実績多数'],
    properFraming: 'AIは手段と考え、現場で続けられる業務フローまで整理する',
  },
  btob_writing: {
    section: 'Sales Knowledge 6-2',
    clientPurpose: 'サービスや課題を、企業担当者が理解・比較・判断できる文章にする',
    hiringConcerns: '内容が抽象的、現場感がない、AIらしい一般論になる',
    winProbability: '中〜高。テーマが業務改善・飲食・AI活用なら高い',
    recommendedExperience: 'BtoB業務改善提案・進捗報告3年、経営層・取引先への資料作成3年、課題整理、AIライティング5記事',
    avoidExpressions: ['BtoBライターとして豊富な実績'],
    properFraming: '現場と提案の両方を経験し、読み手が判断しやすい順序に整理できる',
  },
  seo_article: {
    section: 'Sales Knowledge 6-3',
    clientPurpose: '検索意図に応え、読者の理解や次の行動につながる記事を作る',
    hiringConcerns: 'SEO成果がない、AIの丸投げ、事実誤認、冗長な文章',
    winProbability: '中。成長領域',
    recommendedExperience: 'SEO自主制作2記事、比較記事、商品記事、テストライティング完了、情報整理力',
    avoidExpressions: ['SEOに精通', '上位表示できます'],
    properFraming: '検索意図と読者の疑問を整理し、AIを補助に使いながら事実確認と自分の言葉で仕上げる',
  },
  canva_design: {
    section: 'Sales Knowledge 6-4',
    clientPurpose: '伝えたい情報を、短時間で理解できる見た目にする',
    hiringConcerns: '装飾優先、情報が読みにくい、目的とのずれ',
    winProbability: '中〜高。情報設計中心なら高い',
    recommendedExperience: '経営層・取引先への資料作成3年、提案資料、情報設計、AI画像5作品、Canva Pro',
    avoidExpressions: ['デザイナーとして豊富な実績', 'SNS運用が得意'],
    properFraming: '目的・ターゲット・伝える順序を整理してから制作する',
  },
  whitepaper_service: {
    section: 'Sales Knowledge 6-9',
    clientPurpose: '見込み客に課題を理解してもらい、サービス検討へ進める',
    hiringConcerns: '営業色が強すぎる、読み手の課題とずれる、根拠が弱い',
    winProbability: '中。成長領域',
    recommendedExperience: 'BtoB業務改善提案3年、経営層・取引先へのプレゼン・資料作成3年、PowerPoint提案資料、課題整理・構成力',
    avoidExpressions: ['ホワイトペーパー制作実績あり'],
    properFraming: '直接実績はないが、BtoB提案と改善資料で培った課題整理・構成力を転用できる',
  },
  sns_single_image: {
    section: 'Sales Knowledge 6-10',
    clientPurpose: '投稿・広告の内容を一目で伝え、閲覧や次の行動につなげる',
    hiringConcerns: '運用理解がない、トレンド感が不足、投稿全体との不一致',
    winProbability: '案件次第。情報設計中心なら中',
    recommendedExperience: 'AI画像5作品、商品開発・撮影監修、Canva Pro',
    avoidExpressions: ['SNS運用が得意', 'バズる投稿を作れる'],
    properFraming: '運用代行ではなく、目的と情報の優先順位を整理した単発制作として対応',
  },
  hospitality_content: {
    section: 'Sales Knowledge 6-8',
    clientPurpose: '飲食現場・店舗顧客・運営課題を理解した企画や情報を作る',
    hiringConcerns: '表面的な飲食知識、現場で使えない内容',
    winProbability: '高い。主戦場',
    recommendedExperience: '飲食業22年、店舗運営、商品開発、撮影監修、売上改善、人材育成',
    avoidExpressions: ['飲食経営コンサル', '飲食業界のすべてに精通'],
    properFraming: '現場・数値・人材・顧客の複数視点で内容を整理できる',
  },
};

// ===== 第7章 価値変換辞典（対応する章がある8カテゴリーのみ。無理な流用はしない） =====
// whitepaper_service / sns_single_image に対応する専用セクションはSales Knowledgeに無いため、
// ここに含めない（Stage1側でclientValueをrequires_ai_analysisとして扱う）。
const VALUE_CONVERSION = {
  proposal_document: {
    section: 'Sales Knowledge 7-1',
    entries: [
      { experience: '業務改善・BtoB提案', value: '課題、原因、改善案を順序立てて示す', category: '判断しやすくする', expression: '現場課題と改善案を整理し、読み手が判断しやすい提案構成へ落とし込みます' },
      { experience: '人材育成', value: '初めて見る人にも理解できる説明順序を作る', category: '理解しやすくする', expression: '専門知識を前提にせず、読み手が迷わない情報順序を意識します' },
      { experience: '数値管理', value: '重要数値と意味を整理する', category: '判断しやすくする', expression: '数値を並べるだけでなく、何を判断するための数字かが伝わる形に整理します' },
    ],
  },
  btob_writing: {
    section: 'Sales Knowledge 7-2',
    entries: [
      { experience: 'BtoB提案', value: '相手企業の判断材料を意識できる', category: '判断しやすくする', expression: '提供側の説明だけでなく、読み手が検討するために必要な情報を整理します' },
      { experience: '現場運営', value: '一般論ではなく実務に接続した内容を作る', category: '業務を進めやすくする', expression: '現場で起こる疑問や制約を踏まえ、実務につながる内容へ整えます' },
      { experience: '構成力', value: '結論・理由・具体例を理解しやすく並べる', category: '理解しやすくする', expression: '読み手の疑問が自然に解消される順序で構成します' },
    ],
  },
  seo_article: {
    section: 'Sales Knowledge 7-3',
    entries: [
      { experience: '情報整理', value: '検索者の疑問に必要な情報を過不足なく整理する', category: '理解しやすくする', expression: '検索する方の疑問を分解し、知りたい順序で情報を整理します' },
      { experience: 'AI活用＋品質確認', value: '下調べや構成を効率化し、人の確認で仕上げる', category: '相手の負担を減らす', expression: 'AIは補助に使い、事実確認と文章の自然さは人の目で整えます' },
      { experience: '比較・構成', value: '比較軸を統一する', category: '判断しやすくする', expression: '比較条件を揃え、読者が自分に合う選択をしやすい構成にします' },
    ],
  },
  canva_design: {
    section: 'Sales Knowledge 7-4',
    entries: [
      { experience: '提案資料作成', value: '情報の優先順位を視覚化する', category: '理解しやすくする', expression: '装飾から始めず、最も伝えるべき情報の優先順位を決めて制作します' },
      { experience: '撮影監修・商品理解', value: '商品の特徴と顧客の関心を接続する', category: '成果につながる構造を作る', expression: '商品の特徴を並べるのではなく、見る方にとっての価値が伝わる構成にします' },
      { experience: '品質管理', value: '文字切れ、読みづらさ、配置ずれを確認する', category: 'ミスや認識違いを減らす', expression: 'PC・スマホでの読みやすさと、文字・配置の最終確認まで行います' },
    ],
  },
  ai_business: {
    section: 'Sales Knowledge 7-5',
    entries: [
      { experience: '業務改善＋AI', value: '必要な作業にだけAIを使う', category: '相手の負担を減らす', expression: 'AI導入を目的にせず、現在の業務で負担になっている部分から整理します' },
      { experience: 'Knowledge設計', value: '判断基準や情報を一か所に集める', category: '再現性を高める', expression: '担当者の感覚に依存する判断を、参照できるKnowledgeと手順に整理します' },
      { experience: '自動化運用', value: '反復作業を減らし、続けられる流れを作る', category: '業務を進めやすくする', expression: '作って終わりではなく、日常業務で使う流れまで設計します' },
    ],
  },
  business_improvement: {
    section: 'Sales Knowledge 7-6',
    entries: [
      { experience: '店舗運営・改善', value: '現場の制約を踏まえた改善案を作る', category: '業務を進めやすくする', expression: '現場の動きと負担を確認し、実行できる単位まで改善案を具体化します' },
      { experience: '課題整理', value: '複数問題を原因・優先順位で整理する', category: '判断しやすくする', expression: '目に見える問題だけでなく、原因と優先順位を整理してから対応方針を作ります' },
      { experience: '数値管理', value: '改善後の確認基準を持つ', category: '再現性を高める', expression: '改善内容と確認指標を結びつけ、実行後に判断できる形にします' },
    ],
  },
  manual_training: {
    section: 'Sales Knowledge 7-7',
    entries: [
      { experience: '店長20名以上の育成', value: '初心者がつまずく点を想定する', category: '理解しやすくする', expression: '育成経験を活かし、初めて担当する方が迷いやすい点を先回りして整理します' },
      { experience: '店舗立ち上げ', value: '業務開始に必要な手順を順番にする', category: '業務を進めやすくする', expression: '説明資料ではなく、順番に進めれば業務を完了できる手順へ落とし込みます' },
      { experience: '仕組み化', value: '人によるばらつきを減らす', category: '再現性を高める', expression: '判断基準と確認項目を明確にし、担当者が変わっても使える形を目指します' },
    ],
  },
  hospitality_content: {
    section: 'Sales Knowledge 7-8',
    entries: [
      { experience: '飲食業22年', value: '現場・顧客・数値・人材の複数視点を持つ', category: 'ミスや認識違いを減らす', expression: '飲食現場を22年経験しており、運営側の実情を踏まえて内容を整理できます' },
      { experience: '店長・人材育成', value: '運営者とスタッフ双方の視点を持つ', category: '業務を進めやすくする', expression: '管理者だけでなく、実際に動くスタッフが理解できる内容を意識します' },
      { experience: '商品開発・撮影監修', value: '商品価値を顧客へ伝える', category: '成果につながる構造を作る', expression: '商品そのものの特徴と、顧客に伝えるべき価値を分けて整理します' },
    ],
  },
};

// ===== 第9章 使用禁止・誇張になる表現（案件を問わず常に適用する静的ブロックリスト） =====
// Sales Knowledge 9-1（証明できない数値）・9-2（存在しない受注実績として扱わない自主制作物）・
// 9-3（誇張になる表現）から転記。案件分析AIへの引き継ぎデータにも常に含める。
const GENERAL_PROHIBITED_NUMBERS = [
  '最大管理売上94,900万円', 'イベント予算達成143％', '売上前年比160％',
  '採用面接300件以上', '帳票・シフト管理10年以上', '店舗開発部門支援約1年半',
];

const GENERAL_NOT_CLIENT_WORK = [
  '飲食事業改善 提案資料', 'AIライティングポートフォリオ5記事',
  'みちたびGPTs', '適性診断GPTs', 'Claude Code Knowledge DB', '朝礼自動化システム',
];

const GENERAL_PROHIBITED_EXPRESSIONS = [
  '飲食経営の専門家', '業務改善コンサルタントとして多数の実績', 'BtoB営業で多くの契約を獲得',
  'PowerPoint・Canvaデザイナーとして豊富な実績', 'SEOライターとして上位表示実績多数',
  'AI導入支援の専門家', 'AIシステム開発が可能', 'SNS運用・バズ施策が得意', 'あらゆる業界に対応可能',
  'これまでの経験を活かして貢献します', '丁寧に対応します', '柔軟に対応可能です', '責任を持って取り組みます',
];

module.exports = {
  sourceVersion: 'yuki_sales_knowledge_v1.md (Version 1.0, 2026-07-26) 第6・7・9章',
  // knowledge/yuki_sales_knowledge_v1.md の内容から算出したsha256ハッシュ（転記時点）。
  // knowledge-sync-check.js が照合する。
  sourceContentHash: '1d49b008525e0332564d7d9b2376de2b4df175db39c09e32408cb3b22e71cbbb',
  jobDictionary: JOB_DICTIONARY,
  valueConversion: VALUE_CONVERSION,
  generalProhibited: {
    numbers: GENERAL_PROHIBITED_NUMBERS,
    notClientWork: GENERAL_NOT_CLIENT_WORK,
    expressions: GENERAL_PROHIBITED_EXPRESSIONS,
  },
};
