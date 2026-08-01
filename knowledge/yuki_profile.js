// ゆうき職能プロフィール（構造化データ）
//
// 生成元（このファイルはKnowledgeからの派生データであり、Knowledge本体は変更しない）:
//   - knowledge/yuki_sales_knowledge_v1.md（Version 1.0, 2026-07-26）※営業判断・案件分類はこちらを優先
//   - C:\Users\nagam\knowledge\06_common_knowledge\yuki_common_knowledge.md（最終更新 2026-07-11）
//
// 記載ルール:
//   - Knowledgeに書かれていない経験・実績・能力は追加しない（推測・創作・誇張の禁止 = Sales Knowledge 1-3）
//   - 「要確認」情報（Sales Knowledge 5-2）は evidence として使用しない（usableExperience/selfMadeWorks/clientWorkRecordsに含めない）
//   - Knowledge更新時は、このファイルを手動で再コンパイルすること（Sales Knowledge 10章 更新ルールに準拠）
//
// decisionSource の表記は「Sales Knowledge <章番号>」の形式で統一し、案件評価時にどの根拠に基づく判定かを追跡できるようにする。

// ===== 使用可能ツール（Common Knowledge 3章 + Sales Knowledge CARD-08/CARD-13で確認済み） =====
const AVAILABLE_TOOLS = ['ChatGPT', 'Claude', 'Claude Code', 'Dify', 'PowerPoint', 'Canva'];

// ===== 対応可能業務（主戦場。Sales Knowledge 2-1 + 6-1,6-2,6-5,6-6,6-7,6-8） =====
// 「勝てる可能性：高い」「主戦場」と明記されたカテゴリのみを対応可能業務とする。
const AVAILABLE_CATEGORIES = [
  {
    id: 'proposal_document',
    label: 'PowerPoint・提案資料・営業資料',
    decisionSource: 'Sales Knowledge 6-1（案件辞典）/ 2-1（主戦場）',
    patterns: [
      '提案資料', '営業資料', 'PowerPoint', 'パワーポイント', 'プレゼン資料', 'プレゼンテーション資料',
      '資料作成', '資料デザイン', '資料制作',
    ],
    requiredCapabilities: ['課題整理力', '情報整理力', '構成力', '相手目線', '改善提案力'],
    evidenceCards: ['CARD-07', 'CARD-08'],
    directEvidence: '経営層・取引先へのプレゼン・資料作成3年、PowerPointによる提案資料の作成経験、自主制作「飲食事業改善 提案資料」（8ページ）',
  },
  {
    id: 'btob_writing',
    label: 'BtoBライティング・構成作成',
    decisionSource: 'Sales Knowledge 6-2（案件辞典）/ 2-1（主戦場）',
    patterns: [
      'BtoBライティング', 'BtoB向け', 'BtoBコンテンツ', '企業向け記事', 'サービス紹介文', '導入事例',
    ],
    requiredCapabilities: ['情報整理力', '構成力', '相手目線', '現場理解力'],
    evidenceCards: ['CARD-07', 'CARD-12'],
    directEvidence: 'BtoB業務改善提案・進捗報告3年、経営層・取引先への資料作成3年、AIライティング5記事',
  },
  {
    id: 'ai_business',
    label: 'AI活用・GPTs・Knowledge・仕組み化',
    decisionSource: 'Sales Knowledge 6-5（案件辞典）/ 2-1（主戦場）',
    patterns: [
      'AI活用', 'AI導入', 'AI業務改善', 'GPTs', 'GPT作成', 'Dify', 'Notion構築', 'チャットボット構築',
      'プロンプト設計', 'プロンプト作成', '業務自動化', '自動化', 'ナレッジ設計', 'Knowledge作成', 'AIコンサル', 'AI研修',
    ],
    requiredCapabilities: ['課題整理力', '業務改善力', '仕組み化力', 'AI活用力', '継続運用力'],
    evidenceCards: ['CARD-11'],
    directEvidence: '自主制作物（みちたびGPTs、適性診断GPTs、Claude Code Knowledge DB、朝礼自動化システム）、ChatGPT/Claude Code/Difyの使用経験',
  },
  {
    id: 'business_improvement',
    label: '業務改善・業務フロー',
    decisionSource: 'Sales Knowledge 6-6（案件辞典）/ 2-1（主戦場）',
    patterns: [
      '業務改善', '業務フロー', '業務効率化', '仕組み化', '業務整理',
    ],
    requiredCapabilities: ['現場理解力', '課題発見力', '課題整理力', '改善提案力', '仕組み化力', '継続運用力'],
    evidenceCards: ['CARD-01', 'CARD-02', 'CARD-07', 'CARD-11'],
    directEvidence: 'プロジェクトマネジメント6年、事業部統括マネージャー3年、BtoB業務改善提案・進捗報告3年、複数拠点の数値管理・人材育成10年',
  },
  {
    id: 'manual_training',
    label: 'マニュアル・業務フロー・研修資料',
    decisionSource: 'Sales Knowledge 6-7（案件辞典）/ 2-1（主戦場）',
    patterns: [
      'マニュアル作成', '業務マニュアル', 'マニュアル', '研修資料', '研修コンテンツ', '教育コンテンツ',
    ],
    requiredCapabilities: ['情報整理力', '相手目線', '構成力', '人材育成力', '仕組み化力'],
    evidenceCards: ['CARD-01', 'CARD-03', 'CARD-05'],
    directEvidence: '複数拠点の数値管理・人材育成10年、店長20名以上の育成に関与、新規事業・店舗立ち上げ8年',
  },
  {
    id: 'hospitality_content',
    label: '飲食・店舗運営に関する企画・コンテンツ',
    decisionSource: 'Sales Knowledge 6-8（案件辞典）/ 2-1（主戦場）',
    patterns: [
      '飲食', '店舗運営', '店舗管理', '店舗マネジメント', 'カフェ', 'レストラン', '料理', '商品開発',
      '店舗企画', '店長', '人材育成', '採用面接',
    ],
    requiredCapabilities: ['現場理解力', '相手目線', '改善提案力'],
    evidenceCards: ['CARD-01', 'CARD-02', 'CARD-03', 'CARD-10'],
    directEvidence: '飲食業22年、店長・店舗立ち上げ・売上改善・商品開発・撮影監修の経験',
  },
];

// ===== チャレンジ可能業務（成長領域。Sales Knowledge 2-2 + 6-3,6-4,6-9,6-10） =====
// 直接の受注実績は限定的だが、既存能力・完成物から中核能力を論理的に証明できる領域。
const CHALLENGE_CATEGORIES = [
  {
    id: 'seo_article',
    label: 'SEO・解説記事・体験ライティング',
    decisionSource: 'Sales Knowledge 6-3（案件辞典）/ 2-2（成長領域）',
    patterns: [
      // Sales Knowledge 6-3の対象は「記事」全般（検索意図に応える記事を作る仕事）であり、
      // 複合語（記事作成／記事執筆等）に一致しない「〜記事を書いてください」等の表現も
      // 同じカテゴリーとして拾えるよう、単独の「記事」も対象に含める。
      'SEO記事', 'SEO', '解説記事', '記事作成', '記事執筆', '記事制作', '記事の作成', '記事の執筆', '記事',
      'ブログ記事', 'ブログ', 'Webコンテンツ', 'Web記事', 'コラム', 'note記事', '比較記事',
      '商品レビュー', 'レビュー記事', '体験談', 'ライティング', 'ライター', '執筆',
    ],
    requiredCapabilities: ['情報整理力', '相手目線', '構成力', 'AI活用力', '品質管理力'],
    evidenceCards: ['CARD-12'],
    substituteEvidence: 'AIライティング5記事（note系記事、SEO記事2本、比較記事、商品記事）、テストライティング1件の契約・納品・検収・報酬支払い完了',
    allowedGap: '同一ジャンル・同一クライアントでの受注実績はまだ少ないが、完成済みの記事5本と納品・検収済みの受注1件で構成力・品質管理力を示せる（Sales Knowledge 1-4 対応可能条件）',
  },
  {
    id: 'canva_design',
    label: 'Canva・情報設計中心の画像制作',
    decisionSource: 'Sales Knowledge 6-4（案件辞典）/ 2-2（成長領域）',
    patterns: [
      // 記事カテゴリと同様、「バナー作成」等の表記ゆれを拾えるよう単独の「バナー」も対象に含める
      'Canva', 'AI画像制作', 'AI画像生成', '広告バナー', 'バナー制作', 'バナーデザイン', 'バナー',
      'SNS画像制作', 'SNS画像', 'SNS投稿画像', 'サムネイル', 'アイキャッチ',
    ],
    requiredCapabilities: ['相手目線', '構成力', '情報整理力', 'AI活用力', '品質管理力'],
    evidenceCards: ['CARD-08', 'CARD-10', 'CARD-13'],
    substituteEvidence: 'AI画像ポートフォリオ5作品、Canva Pro使用、経営層・取引先への資料作成3年',
    allowedGap: '受注実績は契約成立1件（納品前）のみだが、用途の異なる完成作品5点で目的・ターゲットを踏まえた情報設計力を示せる',
  },
  {
    id: 'whitepaper_service',
    label: 'ホワイトペーパー・サービス紹介資料',
    decisionSource: 'Sales Knowledge 6-9（案件辞典）/ 2-2（成長領域）',
    patterns: [
      'ホワイトペーパー', 'サービス紹介資料', 'サービス紹介', '導入事例資料',
    ],
    requiredCapabilities: ['課題整理力', '構成力', '情報整理力'],
    evidenceCards: ['CARD-07', 'CARD-08'],
    substituteEvidence: 'BtoB業務改善提案・進捗報告3年、経営層・取引先への資料作成3年、PowerPoint提案資料の作成経験',
    allowedGap: '直接の受注実績はないが、BtoB提案・改善資料で培った課題整理力・構成力を転用できると具体的に説明できる（Sales Knowledge 6-9「適切な見せ方」）',
  },
  {
    id: 'sns_single_image',
    label: 'SNS用画像の単発制作',
    decisionSource: 'Sales Knowledge 6-10（案件辞典）/ 2-3（SNS用画像制作の例外）',
    patterns: [
      'SNS用バナー', 'SNSバナー', 'Instagram投稿画像', 'SNS投稿画像', 'SNS画像制作', '広告画像',
    ],
    requiredCapabilities: ['相手目線', '構成力', '情報整理力'],
    evidenceCards: ['CARD-10', 'CARD-13'],
    substituteEvidence: 'AI画像5作品、商品開発・撮影監修経験、Canva Pro',
    allowedGap: '運用代行を含まない単発制作に限り、構成・情報設計が重要でターゲット・目的が明確な場合はチャレンジ可能（運用代行の要素があれば非希望領域として対応不可）',
  },
];

// ===== 対応不可業務・非希望領域（Sales Knowledge 2-3 + 5-4 使用禁止） =====
// 「詐欺・勧誘・稼働条件・性別地域限定・資格必須・指定ツール必須」等の安全性/必須条件系は
// evaluator.js側の既存ゲート（config.jsのRISK_PATTERNS等）で判定するためここには含めない。
// ここに含めるのは、Sales Knowledgeが明示的に「対象外」「使用禁止」と定めた業務領域のみ。
const EXCLUDED_AREAS = [
  {
    id: 'large_system_dev',
    label: '専門的・大規模なシステム開発',
    decisionSource: 'Sales Knowledge 2-3（対象外・優先しない）/ 5-4（使用禁止：大規模システム開発に対応可能）/ CARD-11 使用上の注意',
    // 既存のAI_TECHNICAL_KEYWORDS（config.js）を参照して判定する（補助配列として再利用）
    useConfigPatterns: 'AI_TECHNICAL_KEYWORDS',
  },
  {
    id: 'real_estate',
    label: '不動産業界の実務経験・不動産管理システム開発',
    decisionSource: 'Sales Knowledge 5-4（使用禁止：不動産業界の実務経験、不動産管理会社向けシステム開発実績）',
    patterns: ['不動産管理会社', '不動産業界', '不動産開発', '不動産売買', '不動産投資'],
  },
  {
    id: 'low_asset_work',
    label: '単純作業・視聴・アンケート・紹介のみで長期資産にならない案件',
    decisionSource: 'Sales Knowledge 2-3（対象外・優先しない：単純作業中心で長期資産にならない案件）',
    // 既存のGROWTH_DISQUALIFYING_PATTERNS（視聴・アンケート・紹介パートナー等）を参照
    useConfigPatterns: 'GROWTH_DISQUALIFYING_PATTERNS',
  },
];

// ===== 能力辞典（Sales Knowledge 4章） =====
// 各能力について「代替証明として使える案件」「証明不足になる案件」を保持する。
const CAPABILITIES = {
  課題発見力: {
    evidenceCards: ['CARD-01', 'CARD-02', 'CARD-06', 'CARD-07'],
    substituteFor: '他業界の業務改善、提案資料',
    insufficientFor: '高度な専門診断・監査が必須の案件',
  },
  課題整理力: {
    evidenceCards: ['CARD-02', 'CARD-07', 'CARD-08', 'CARD-11'],
    substituteFor: '他業界の提案資料、営業資料、AI活用整理',
    insufficientFor: '専門資格・高度な技術判断が中核の案件',
  },
  情報整理力: {
    evidenceCards: ['CARD-04', 'CARD-08', 'CARD-11', 'CARD-12', 'CARD-13', 'CARD-14'],
    substituteFor: 'マニュアル、ホワイトペーパー、他業界の資料',
    insufficientFor: '高度な専門知識の正確性自体が中核の案件',
  },
  業務改善力: {
    evidenceCards: ['CARD-01', 'CARD-02', 'CARD-03', 'CARD-07', 'CARD-11'],
    substituteFor: '他業界の小規模業務改善、マニュアル、AI活用整理',
    insufficientFor: '大規模組織改革、専門システム開発を伴う案件',
  },
  改善提案力: {
    evidenceCards: ['CARD-02', 'CARD-07', 'CARD-08'],
    substituteFor: '他業界の営業資料、BtoBライティング',
    insufficientFor: '成果保証や高度な業界専門性が必須の提案',
  },
  数値管理力: {
    evidenceCards: ['CARD-01', 'CARD-02', 'CARD-04', 'CARD-07'],
    substituteFor: '他業界のレポート・リサーチ整理',
    insufficientFor: '会計・財務・税務の専門判断、大規模データ分析',
  },
  人材育成力: {
    evidenceCards: ['CARD-01', 'CARD-05'],
    substituteFor: '他業界のマニュアル、研修資料、教育コンテンツ',
    insufficientFor: '専門資格教育や登壇実績が必須の研修',
  },
  相手目線: {
    evidenceCards: ['CARD-05', 'CARD-06', 'CARD-07', 'CARD-08', 'CARD-10', 'CARD-12', 'CARD-13'],
    substituteFor: 'ライティング、Canva、サービス紹介',
    insufficientFor: '特定専門職の深い顧客理解が必須の案件',
  },
  構成力: {
    evidenceCards: ['CARD-05', 'CARD-07', 'CARD-08', 'CARD-12', 'CARD-13'],
    substituteFor: 'ホワイトペーパー、サービス紹介資料',
    insufficientFor: '高度な専門知識や大規模実績が必須の制作',
  },
  仕組み化力: {
    evidenceCards: ['CARD-03', 'CARD-05', 'CARD-11'],
    substituteFor: '他業界の小規模マニュアル、AI活用整理',
    insufficientFor: '大規模システム開発、全社基幹業務の設計',
  },
  現場理解力: {
    evidenceCards: ['CARD-01', 'CARD-02', 'CARD-03', 'CARD-05', 'CARD-10'],
    substituteFor: '他業界の現場業務改善',
    insufficientFor: '未経験業界の専門実務経験が必須の案件',
  },
  AI活用力: {
    evidenceCards: ['CARD-11', 'CARD-12', 'CARD-13'],
    substituteFor: '小規模なAI活用整理、業務フロー改善',
    insufficientFor: '大規模AIシステム開発、企業導入実績が必須の案件',
  },
  継続運用力: {
    evidenceCards: ['CARD-01', 'CARD-04', 'CARD-05', 'CARD-11'],
    substituteFor: '他業界のマニュアル、運用設計',
    insufficientFor: '大規模組織・システムの保守運用',
  },
  品質管理力: {
    evidenceCards: ['CARD-04', 'CARD-10', 'CARD-12', 'CARD-13', 'CARD-14'],
    substituteFor: 'マニュアル、サービス紹介資料',
    insufficientFor: '法務・医療・会計など専門監修が必須の品質保証',
  },
};

// ===== 転用可能な能力（能力辞典のキー一覧） =====
const TRANSFERABLE_SKILLS = Object.keys(CAPABILITIES);

// ===== 非希望領域（EXCLUDED_AREASのラベル一覧） =====
const NON_PREFERRED_AREAS = EXCLUDED_AREAS.map(a => a.label);

// ===== 使用可能な経験・実績（Sales Knowledge 5-1 使用可能のみ。要確認は含めない） =====
const USABLE_EXPERIENCE = [
  { category: '経験年数', item: '飲食業22年', usage: '「飲食業に22年間従事」という表現で使用可能' },
  { category: '役割・経験年数', item: 'プロジェクトマネジメント6年（飲食事業）', usage: '非飲食案件では、担当職能と転用方法を示し、他業界の直接実績と誤認させない' },
  { category: '役割・経験年数', item: '事業部統括マネージャー3年（飲食事業）', usage: '統括範囲を案件文に合わせて拡張しない' },
  { category: '役割・経験年数', item: 'BtoB業務改善提案・進捗報告3年（飲食事業）', usage: '契約件数・売上・提案採用数は要確認情報のため使用しない' },
  { category: '役割・経験年数', item: '経営層・取引先へのプレゼン・資料作成3年（飲食事業）', usage: '資料の公開可否・提案採用結果とは分けて扱う' },
  { category: '役割・経験年数', item: '新規事業・店舗立ち上げ8年（飲食事業）', usage: '個別案件の担当範囲を追加しない' },
  { category: '役割・経験年数', item: '複数拠点の数値管理・人材育成10年（飲食事業）', usage: '帳票・シフト管理10年以上（要確認）とは別の確認済み事実' },
  { category: '役割・経験年数', item: '関係者調整・進行管理6年（飲食事業）', usage: '店舗開発部門支援の未確認情報を根拠に含めない' },
  { category: '担当業務', item: '店長、店舗運営、店舗立ち上げ、売上改善、数値管理、人材育成、業務改善', usage: '役職期間・担当範囲を追加しない' },
  { category: '担当業務', item: '飲食事業の運営受託におけるBtoB提案', usage: '受注件数・契約成果は要確認' },
  { category: '具体的数値', item: '店長20名以上の育成に関与（本人確認済み）', usage: '「昇格させた人数」とは表現しない' },
  { category: '制作物', item: 'リブランディング提案資料、採用課題改善提案資料の作成経験', usage: '公開可否は要確認' },
  { category: '制作物', item: '飲食事業改善 提案資料（8ページ、自主制作）', usage: '自主制作と明記' },
  { category: 'ポートフォリオ', item: 'Webポートフォリオ', usage: '最新URLを使用' },
  { category: '受注実績', item: '商品リサーチ案件の契約', usage: '納品・評価は要確認のため「完了実績」とはしない' },
  { category: '受注実績', item: 'テストライティング1件の契約・納品・検収・報酬支払い完了', usage: '外部案件を完了した証明として使用可能' },
  { category: '受注実績', item: 'AI画像作成サポート案件の契約成立（2026-07-26時点）', usage: '契約実績としてのみ使用。納品実績とはしない' },
  { category: '実体験', item: '飲食現場、店舗運営、店長、人材育成、タクシードライバー、AI学習・実践', usage: '案件に関係する体験のみ使用' },
];

// ===== 自主制作物（受注実績と明確に分離。Sales Knowledge 8-1） =====
const SELF_MADE_WORKS = [
  'みちたびGPTs',
  '適性診断GPTs',
  'Claude Code Knowledge DB',
  '朝礼自動化システム',
  'AIライティング5記事（note系記事、SEO記事2本、比較記事、商品記事）',
  'AI画像5作品',
  '飲食事業改善 提案資料（8ページ、自主制作）',
  'noteストーリー記事',
  'Webポートフォリオ（AIライティングページ、AI画像制作ページ、AI活用・業務改善ページ）',
];

// ===== 受注実績（自主制作物と分離。Sales Knowledge 8-1/8-2） =====
const CLIENT_WORK_RECORDS = [
  { label: 'テストライティング案件', status: '納品・検収・報酬支払い完了', usage: '外部案件を完了した証明として使用可能' },
  { label: '商品リサーチ案件', status: '契約成立（納品・検収・評価は要確認）', usage: '契約実績としてのみ使用。完了実績とは表現しない' },
  { label: 'AI画像作成サポート案件', status: '2026-07-26時点で契約成立（納品前）', usage: '契約実績としてのみ使用。納品実績とはしない' },
];

// ===== 実績獲得フェーズで許容する不足（Sales Knowledge 1-4 + 2-4） =====
const PHASE_ALLOWED_GAPS = {
  allow: [
    '同一案件の直接受注実績がないこと（複数の代替経験・完成物から中核能力を論理的に証明できる場合）',
    '未経験部分がある場合でも、具体的な作業手順・確認方法・品質管理方法を説明できること',
    '要確認情報（金額・期間等が未確定な実績）を主要根拠にせず、確認済み情報のみで能力証明が成立すること',
  ],
  disallow: [
    '必須能力を証明できる経験・制作物が全くないこと',
    '実務経験が必須条件で、代替証明が認められていない案件であること',
    '誇張しなければ採用条件を満たせないこと',
    '現実的に納期・稼働量・作業範囲を守れないこと',
  ],
};

module.exports = {
  sourceVersion: {
    sales: 'yuki_sales_knowledge_v1.md (Version 1.0, 2026-07-26)',
    common: 'yuki_common_knowledge.md (最終更新 2026-07-11)',
  },
  tools: { available: AVAILABLE_TOOLS },
  availableCategories: AVAILABLE_CATEGORIES,
  challengeCategories: CHALLENGE_CATEGORIES,
  excludedAreas: EXCLUDED_AREAS,
  capabilities: CAPABILITIES,
  transferableSkills: TRANSFERABLE_SKILLS,
  nonPreferredAreas: NON_PREFERRED_AREAS,
  usableExperience: USABLE_EXPERIENCE,
  selfMadeWorks: SELF_MADE_WORKS,
  clientWorkRecords: CLIENT_WORK_RECORDS,
  phaseAllowedGaps: PHASE_ALLOWED_GAPS,
};
