// ゆうき職能プロフィール（構造化データ）— v2
//
// 生成元（このファイルはKnowledgeからの派生データであり、Knowledge本体は変更しない）:
//   - knowledge/yuki_sales_knowledge_v1.md（Version 1.0, 2026-07-26）※営業判断・案件分類はこちらを優先
//   - C:\Users\nagam\knowledge\06_common_knowledge\yuki_common_knowledge.md（最終更新 2026-07-11）
//
// v2での変更点（監査結果への対応）:
//   - 「飲食業22年」等のテーマ・業界経験を、案件の主タスク（何を作る仕事か）を判定する
//     TASK_CATEGORIESから完全に分離し、DOMAIN_EXPERIENCESという独立した"追加根拠"にした。
//     これにより、案件テーマが食・店舗関連であっても、実際に依頼される作業（執筆／資料作成／
//     画像制作等）に対応する証拠（成果物・受注実績）だけが主根拠になり、テーマ経験は
//     「テーマ理解の補足」としてのみ併記される。
//   - TASK_CATEGORIESは「対応可能（主戦場）」「チャレンジ可能（成長領域）」を問わず
//     1つの優先順位リストとして判定し、最初に一致したカテゴリーの階層（主戦場/成長領域）を
//     そのままcapabilityStatusに使う。これにより「ライター募集」等の職種名が、
//     テーマ一致（飲食）よりも先に正しく職種カテゴリー（ライティング＝成長領域）で判定される。
//   - 各カテゴリーの証拠は deliverableEvidence（成果物）／paidExperience（受注・実務実績）／
//     selfProducedEvidence（自主制作物）に分離し、存在しないものは null のままにする
//     （存在しない証拠を埋めない＝Sales Knowledge 1-3 創作禁止の原則に従う）。
//   - 動画編集をEXCLUDED_AREASに明示追加（Sales Knowledgeに対応可能・チャレンジ可能業務としての
//     記載が一切ないため）。ただし動画シナリオ作成・台本作成等の文章タスクはSEO_ARTICLEの
//     パターンに追加し、「動画」という語だけで一律除外しないようにした。
//   - マニュアル関連カテゴリーは「マニュアル作成」等の動詞を伴う複合語のみに限定し、
//     「マニュアル完備」「マニュアルあり」等（クライアントが用意する支援情報）を
//     業務内容と誤読しないようにした。

// ===== 使用可能ツール（Common Knowledge 3章 + Sales Knowledge CARD-08/CARD-13で確認済み） =====
const AVAILABLE_TOOLS = ['ChatGPT', 'Claude', 'Claude Code', 'Dify', 'PowerPoint', 'Canva'];

// ===== ドメイン（業界・テーマ）経験 =====
// 案件の主タスクとは独立して判定する「テーマへの土地勘」の根拠。
// triggersに挙げた語が案件文に実際に含まれる場合だけ、判定理由に追加情報として併記する。
// 単独では評価対象カテゴリーを決定しない（＝これだけでcapabilityStatusは決まらない）。
const DOMAIN_EXPERIENCES = [
  {
    id: 'hospitality_theme',
    label: '飲食・店舗テーマ理解',
    // ユーザー指定の範囲に限定（"店長"「人材育成」等の一般語は含めない＝過剰適用の原因だったため）
    triggers: ['飲食', '食品', 'レシピ', 'カフェ', '店舗運営', '接客', '商品開発', '飲食事業改善'],
    text: '飲食業22年、店長・店舗立ち上げ・売上改善・商品開発・撮影監修の経験',
    decisionSource: 'Sales Knowledge CARD-01/CARD-02/CARD-10',
  },
];

// ===== タスクカテゴリー（優先順位付き単一リスト） =====
// 「案件文にどの動詞・成果物名が現れるか」で判定する。tier: 'available'=対応可能業務（主戦場）、
// 'challenge'=チャレンジ可能業務（成長領域）。Sales Knowledge 2-1/2-2の区分をそのまま反映。
// 配列の並び順が優先順位（最初に一致したものを採用）。
const TASK_CATEGORIES = [
  {
    id: 'proposal_document',
    tier: 'available',
    label: 'PowerPoint・提案資料・営業資料',
    decisionSource: 'Sales Knowledge 6-1（案件辞典）/ 2-1（主戦場）',
    patterns: [
      '提案資料', '営業資料', 'PowerPoint', 'パワーポイント', 'プレゼン資料', 'プレゼンテーション資料',
      '資料作成', '資料デザイン', '資料制作',
    ],
    requiredCapabilities: ['課題整理力', '情報整理力', '構成力', '相手目線', '改善提案力'],
    deliverableEvidence: '自主制作「飲食事業改善 提案資料」（8ページ）',
    paidExperience: '経営層・取引先へのプレゼン・資料作成3年、PowerPointによる提案資料の作成経験（飲食事業）',
    selfProducedEvidence: '自主制作「飲食事業改善 提案資料」（8ページ）',
    toolsUsed: ['PowerPoint'],
  },
  {
    id: 'manual_training',
    tier: 'available',
    label: 'マニュアル・業務フロー・研修資料',
    decisionSource: 'Sales Knowledge 6-7（案件辞典）/ 2-1（主戦場）',
    // 「マニュアル完備」「マニュアルあり」等の支援情報と区別するため、動詞を伴う複合語のみに限定
    patterns: [
      'マニュアル作成', '業務マニュアル作成', 'マニュアルの作成', '研修資料作成', '研修資料の作成',
      '研修コンテンツ作成', '教育コンテンツ作成', 'マニュアル制作', '手順書作成',
    ],
    requiredCapabilities: ['情報整理力', '相手目線', '構成力', '人材育成力', '仕組み化力'],
    deliverableEvidence: null, // 過去のマニュアル・研修資料の現存・公開可否はSales Knowledge上「要確認」のため使用しない
    paidExperience: '複数拠点の数値管理・人材育成10年、店長20名以上の育成に関与、新規事業・店舗立ち上げ8年（飲食事業）',
    selfProducedEvidence: null,
    toolsUsed: null,
  },
  {
    id: 'business_improvement',
    tier: 'available',
    label: '業務改善・業務フロー',
    decisionSource: 'Sales Knowledge 6-6（案件辞典）/ 2-1（主戦場）',
    patterns: ['業務改善', '業務フロー', '業務効率化', '仕組み化', '業務整理'],
    requiredCapabilities: ['現場理解力', '課題発見力', '課題整理力', '改善提案力', '仕組み化力', '継続運用力'],
    deliverableEvidence: '自主制作「飲食事業改善 提案資料」（8ページ）',
    paidExperience: 'プロジェクトマネジメント6年、事業部統括マネージャー3年、BtoB業務改善提案・進捗報告3年（飲食事業）',
    selfProducedEvidence: '自主制作「飲食事業改善 提案資料」（8ページ）',
    toolsUsed: null,
  },
  {
    id: 'ai_business',
    tier: 'available',
    label: 'AI活用・GPTs・Knowledge・仕組み化',
    decisionSource: 'Sales Knowledge 6-5（案件辞典）/ 2-1（主戦場）',
    patterns: [
      'AI活用', 'AI導入', 'AI業務改善', 'GPTs', 'GPT作成', 'Dify', 'Notion構築', 'チャットボット構築',
      'プロンプト設計', 'プロンプト作成', '業務自動化', '自動化', 'ナレッジ設計', 'Knowledge作成', 'AIコンサル', 'AI研修',
    ],
    requiredCapabilities: ['課題整理力', '業務改善力', '仕組み化力', 'AI活用力', '継続運用力'],
    deliverableEvidence: '自主制作物（みちたびGPTs、適性診断GPTs、Claude Code Knowledge DB、朝礼自動化システム）',
    paidExperience: null, // 外部企業へのAI導入・改善成果はSales Knowledge 5-3で未証明
    selfProducedEvidence: '自主制作物（みちたびGPTs、適性診断GPTs、Claude Code Knowledge DB、朝礼自動化システム）',
    toolsUsed: ['ChatGPT', 'Claude Code', 'Dify'],
  },
  {
    id: 'btob_writing',
    tier: 'available',
    label: 'BtoBライティング・構成作成',
    decisionSource: 'Sales Knowledge 6-2（案件辞典）/ 2-1（主戦場）',
    patterns: ['BtoBライティング', 'BtoB向け', 'BtoBコンテンツ', '企業向け記事', 'サービス紹介文', '導入事例'],
    requiredCapabilities: ['情報整理力', '構成力', '相手目線', '現場理解力'],
    deliverableEvidence: 'AIライティング5記事（note系記事、SEO記事2本、比較記事、商品記事）',
    paidExperience: 'BtoB業務改善提案・進捗報告3年（飲食事業）、テストライティング1件の契約・納品・検収・報酬支払い完了',
    selfProducedEvidence: 'AIライティング5記事',
    toolsUsed: ['ChatGPT', 'Claude'],
  },
  {
    id: 'seo_article',
    tier: 'challenge',
    label: 'SEO・解説記事・体験ライティング',
    decisionSource: 'Sales Knowledge 6-3（案件辞典）/ 2-2（成長領域）',
    patterns: [
      // Sales Knowledge 6-3の対象は「記事」全般（検索意図に応える記事を作る仕事）であり、
      // 複合語（記事作成／記事執筆等）に一致しない「〜記事を書いてください」等の表現も
      // 同じカテゴリーとして拾えるよう、単独の「記事」も対象に含める。
      'SEO記事', 'SEO', '解説記事', '記事作成', '記事執筆', '記事制作', '記事の作成', '記事の執筆', '記事',
      'ブログ記事', 'ブログ', 'Webコンテンツ', 'Web記事', 'コラム', 'note記事', '比較記事',
      '商品レビュー', 'レビュー記事', '体験談', 'ライティング', 'ライター', '執筆',
      // 動画「編集」ではなく文章構成タスクであることが明確な語（除外対象の動画編集とは区別する）
      '動画シナリオ作成', 'YouTube台本作成', 'ナレーション原稿作成', '構成作成', '台本作成', 'シナリオ作成',
    ],
    requiredCapabilities: ['情報整理力', '相手目線', '構成力', 'AI活用力', '品質管理力'],
    deliverableEvidence: 'AIライティング5記事（note系記事、SEO記事2本、比較記事、商品記事）',
    paidExperience: 'テストライティング1件の契約・納品・検収・報酬支払い完了',
    selfProducedEvidence: 'AIライティング5記事',
    toolsUsed: ['ChatGPT', 'Claude'],
  },
  {
    id: 'canva_design',
    tier: 'challenge',
    label: 'Canva・情報設計中心の画像制作',
    decisionSource: 'Sales Knowledge 6-4（案件辞典）/ 2-2（成長領域）',
    patterns: [
      // 記事カテゴリと同様、「バナー作成」等の表記ゆれを拾えるよう単独の「バナー」も対象に含める
      'Canva', 'AI画像制作', 'AI画像生成', '広告バナー', 'バナー制作', 'バナーデザイン', 'バナー',
      'SNS画像制作', 'SNS画像', 'SNS投稿画像', 'サムネイル', 'アイキャッチ',
    ],
    requiredCapabilities: ['相手目線', '構成力', '情報整理力', 'AI活用力', '品質管理力'],
    deliverableEvidence: 'AI画像ポートフォリオ5作品',
    paidExperience: 'AI画像作成サポート案件の契約成立（2026-07-26時点、納品前）',
    selfProducedEvidence: 'AI画像5作品',
    toolsUsed: ['Canva'],
  },
  {
    id: 'whitepaper_service',
    tier: 'challenge',
    label: 'ホワイトペーパー・サービス紹介資料',
    decisionSource: 'Sales Knowledge 6-9（案件辞典）/ 2-2（成長領域）',
    patterns: ['ホワイトペーパー', 'サービス紹介資料', 'サービス紹介', '導入事例資料'],
    requiredCapabilities: ['課題整理力', '構成力', '情報整理力'],
    deliverableEvidence: null, // ホワイトペーパーの完成サンプルはSales Knowledge 8-4で未証明
    paidExperience: 'BtoB業務改善提案・進捗報告3年、経営層・取引先への資料作成3年（飲食事業）',
    selfProducedEvidence: null,
    toolsUsed: ['PowerPoint'],
  },
  {
    id: 'sns_single_image',
    tier: 'challenge',
    label: 'SNS用画像の単発制作',
    decisionSource: 'Sales Knowledge 6-10（案件辞典）/ 2-3（SNS用画像制作の例外）',
    patterns: ['SNS用バナー', 'SNSバナー', 'Instagram投稿画像', 'SNS投稿画像', 'SNS画像制作', '広告画像', 'フィード画像制作', '1投稿分のデザイン'],
    requiredCapabilities: ['相手目線', '構成力', '情報整理力'],
    deliverableEvidence: 'AI画像5作品',
    paidExperience: 'AI画像作成サポート案件の契約成立（2026-07-26時点、納品前）',
    selfProducedEvidence: 'AI画像5作品',
    toolsUsed: ['Canva'],
  },
  {
    id: 'hospitality_content',
    tier: 'available',
    label: '飲食・店舗運営に関する企画・コンテンツ',
    decisionSource: 'Sales Knowledge 6-8（案件辞典）/ 2-1（主戦場）',
    // 上記のいずれのタスクカテゴリーにも一致しなかった場合の、飲食テーマ限定フォールバック。
    // トリガーはDOMAIN_EXPERIENCESと同じ狭い範囲に限定する（過剰適用の原因だったため）。
    patterns: ['飲食', '食品', 'レシピ', 'カフェ', '店舗運営', '接客', '商品開発', '飲食事業改善'],
    requiredCapabilities: ['現場理解力', '相手目線', '改善提案力'],
    deliverableEvidence: '自主制作「飲食事業改善 提案資料」（8ページ）',
    paidExperience: null, // 飲食テーマそのものでの外部受注実績はまだない
    selfProducedEvidence: '自主制作「飲食事業改善 提案資料」（8ページ）',
    toolsUsed: null,
  },
];

// ===== 対応不可業務・非希望領域（Sales Knowledge 2-3 + 5-4 使用禁止） =====
// 「詐欺・勧誘・稼働条件・性別地域限定・資格必須・指定ツール必須」等の安全性/必須条件系は
// evaluator.js側の既存ゲート（config.jsのRISK_PATTERNS等）で判定するためここには含めない。
// ここに含めるのは、Sales Knowledgeが明示的に「対象外」「使用禁止」と定めた業務領域、
// および対応可能・チャレンジ可能業務のいずれにも記載のない業務（動画編集）のみ。
const EXCLUDED_AREAS = [
  {
    id: 'video_editing',
    label: '動画編集（動画シナリオ・台本作成等の文章タスクを除く）',
    decisionSource: 'Sales Knowledge 2-1/2-2（対応可能業務・チャレンジ可能業務のいずれにも動画編集の記載なし）',
    // 「動画」という語だけでは判定せず、編集作業を明示する語のみを対象にする。
    // 動画シナリオ作成・台本作成等はTASK_CATEGORIES（seo_article）側で別途ライティングとして判定する。
    patterns: ['動画編集', 'YouTube編集', 'テロップ入れ', 'カット編集', 'Premiere Pro', 'CapCut'],
  },
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
// タスクカテゴリー（TASK_CATEGORIES）のパターンに一致しない場合の、能力レベルでの
// 救済判定に使う。
//
// signals: 案件文に実際に含まれるかを判定する語（単語・複合語の部分一致）。
// substituteFor/insufficientForはSales Knowledge 4章の「代替証明として使える案件」
// 「証明不足になる案件」列の説明文（人が読むための文章）であり、この2つは表示・説明用
// にのみ使う。signalsは、それとは別に「依頼される作業・成果物」を表す実際の求人語彙
// （TASK_CATEGORIES.patternsではカバーしきれていない表記ゆれを含む）として新設した。
// 監査で発見された取りこぼし語彙（デザイナー募集／投稿制作／画像制作／リサーチャー等）
// を含む。存在しない実績・経験の追加ではなく、既存の確認済み能力・証拠への
// 「入口（案件文の言い回し）」を広げるものであり、証拠そのものは変更していない。
const CAPABILITIES = {
  課題発見力: {
    substituteFor: '他業界の業務改善、提案資料', insufficientFor: '高度な専門診断・監査が必須の案件',
    signals: ['課題発見', '現状分析', '課題抽出'],
  },
  課題整理力: {
    substituteFor: '他業界の提案資料、営業資料、AI活用整理', insufficientFor: '専門資格・高度な技術判断が中核の案件',
    signals: ['課題整理', 'PMO', 'プロジェクトマネジメント', 'PM支援', 'プロジェクト管理'],
  },
  情報整理力: {
    substituteFor: 'マニュアル、ホワイトペーパー、他業界の資料', insufficientFor: '高度な専門知識の正確性自体が中核の案件',
    signals: ['情報整理', 'リサーチャー', 'データ整理', '情報収集', '情報発信サポート'],
  },
  業務改善力: {
    substituteFor: '他業界の小規模業務改善、マニュアル、AI活用整理', insufficientFor: '大規模組織改革、専門システム開発を伴う案件',
    signals: ['業務改善支援', '効率化支援'],
  },
  改善提案力: {
    substituteFor: '他業界の営業資料、BtoBライティング', insufficientFor: '成果保証や高度な業界専門性が必須の提案',
    signals: ['改善提案', '企画提案'],
  },
  数値管理力: {
    substituteFor: '他業界のレポート・リサーチ整理', insufficientFor: '会計・財務・税務の専門判断、大規模データ分析',
    signals: ['数値管理', 'レポート作成', 'データ集計'],
  },
  人材育成力: {
    substituteFor: '他業界のマニュアル、研修資料、教育コンテンツ', insufficientFor: '専門資格教育や登壇実績が必須の研修',
    signals: ['人材育成', '教育コンテンツ', '研修支援'],
  },
  相手目線: {
    substituteFor: 'ライティング、Canva、サービス紹介', insufficientFor: '特定専門職の深い顧客理解が必須の案件',
    signals: ['デザイナー募集', '投稿デザイン', '投稿制作', 'コンテンツ制作', 'フィード投稿', '画像制作'],
  },
  構成力: {
    substituteFor: 'ホワイトペーパー、サービス紹介資料', insufficientFor: '高度な専門知識や大規模実績が必須の制作',
    signals: ['構成作成', 'ページ制作', 'サイト制作'],
  },
  仕組み化力: {
    substituteFor: '他業界の小規模マニュアル、AI活用整理', insufficientFor: '大規模システム開発、全社基幹業務の設計',
    signals: ['仕組み化支援', 'フロー整理'],
  },
  現場理解力: {
    substituteFor: '他業界の現場業務改善', insufficientFor: '未経験業界の専門実務経験が必須の案件',
    signals: ['現場業務改善', '現場支援'],
  },
  AI活用力: {
    substituteFor: '小規模なAI活用整理、業務フロー改善', insufficientFor: '大規模AIシステム開発、企業導入実績が必須の案件',
    signals: ['AI活用整理', 'AIツール活用', 'AI業務支援'],
  },
  継続運用力: {
    substituteFor: '他業界のマニュアル、運用設計', insufficientFor: '大規模組織・システムの保守運用',
    signals: ['運用設計支援'],
  },
  品質管理力: {
    substituteFor: 'マニュアル、サービス紹介資料', insufficientFor: '法務・医療・会計など専門監修が必須の品質保証',
    signals: ['品質管理', '品質チェック'],
  },
};

const TRANSFERABLE_SKILLS = Object.keys(CAPABILITIES);
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
  domainExperiences: DOMAIN_EXPERIENCES,
  taskCategories: TASK_CATEGORIES,
  excludedAreas: EXCLUDED_AREAS,
  capabilities: CAPABILITIES,
  transferableSkills: TRANSFERABLE_SKILLS,
  nonPreferredAreas: NON_PREFERRED_AREAS,
  usableExperience: USABLE_EXPERIENCE,
  selfMadeWorks: SELF_MADE_WORKS,
  clientWorkRecords: CLIENT_WORK_RECORDS,
  phaseAllowedGaps: PHASE_ALLOWED_GAPS,
};
