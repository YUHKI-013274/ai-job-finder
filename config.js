// 検索キーワードと除外ルール設定
const SEARCH_KEYWORDS = [
  'ChatGPT',
  'Claude',
  'Claude Code',
  '生成AI',
  'AI活用',
  'AI導入',
  'AI業務改善',
  'AI導入支援',
  'AIコンサル',
  'AI研修',
  '業務効率化',
  '仕組み化',
  '自動化',
  '業務改善',
  'RPA',
  'Notion',
  'Notion構築',
  'Dify',
  'チャットボット構築',
  'AI画像生成',
  'AI漫画',
  'プロンプト作成',
  '採用支援',
  '採用代行',
  'マニュアル作成',
  '業務マニュアル',
];

// 除外パターン（完全除外）
const EXCLUDE_PATTERNS = [
  'オンライン秘書',
  '一般事務',
  'テレアポ',
  'カスタマーサポートのみ',
  '週30時間',
  '週40時間',
  '専門エンジニア経験必須',
];

// 降格パターン（ランクを強制的に下げる）
const DOWNGRADE_PATTERNS = [
  'ライター募集',
  'ブログ記事',
  'アンケート',
  'SNS運用のみ',
  '動画編集のみ',
  'データ入力',
  'WordPressでLP',
  'Webデザイン',
  'ピン画像',
  'アイキャッチ画像',
  'パン屋',
  'カフェ',
  'ゲーム実況',
  'Canvaで',
  'SNS投稿デザイン',
  '広告バナーの背景',
  'スライド用の画像',
  'Pinterest',
];

// リスクありパターン（詐欺・トラブル警戒サイン）
const RISK_PATTERNS = [
  '登録料',
  '保証金',
  '前払い',
  '身分証明書の写しを送付',
  '口座情報を先に',
  'LINEに誘導',
  '外部サイトで契約',
  '在宅で簡単に稼げる',
  '誰でも高収入',
  'マルチ商法',
  '副業紹介',
  '初期費用',
];

// 最低報酬ライン（円）。これを下回る固定報酬案件は「単価が低すぎる」として除外
const MIN_PRICE_YEN = 3000;

// 1回の検索で最低限確保したい生データ件数・応募候補の最低件数
const MIN_RAW_JOBS = 20;
const MIN_CANDIDATES = 10;

// Sランク評価キーワード（AI導入・業務改善直結）
const S_RANK_KEYWORDS = [
  'ChatGPT', 'Claude', 'Claude Code', '生成AI', 'AI業務改善',
  'AI導入', 'AI活用支援', 'GPT', 'GPTs', '業務自動化',
  '仕組み化', 'AI研修', 'AI構築', 'AIシステム',
];

// Aランク評価キーワード
const A_RANK_KEYWORDS = [
  'AI活用', '業務改善', '業務効率化', '採用支援', 'マニュアル作成',
  'Notion', 'AI画像生成', 'AI漫画', '画像生成AI', '自動化',
  'フロー設計', 'マニュアル整備',
];

// ゆうきの強み（提案文ヒント生成に使用）
const YUKI_STRENGTHS = {
  management: ['店長', 'マネージャー', '売上管理', '数値分析', '人材育成', '採用'],
  ai: ['ChatGPT', 'Claude', '生成AI', 'AI活用', 'Notion', 'AI画像生成'],
  operations: ['業務改善', '仕組み化', '自動化', '業務効率化', 'マニュアル'],
  hospitality: ['飲食', '店舗', '接客', 'サービス'],
};

// 提案文の強み候補
const STRENGTH_HINTS = {
  ai: '飲食業界22年の実務経験×ChatGPT/Claude活用スキルで、現場視点のAI導入を提案できます',
  management: '300名以上の採用面接経験と店舗マネジメント実績で、実用的な仕組みを構築できます',
  operations: '10年以上の業務改善・事務管理経験で、再現性のあるマニュアルや仕組みを作れます',
  notion: 'Notion活用×業務設計の実績で、使いやすいシステムを構築できます',
  general: '22年の実務経験を持つ現場出身者として、使える成果物を納品します',
};

module.exports = {
  SEARCH_KEYWORDS,
  EXCLUDE_PATTERNS,
  DOWNGRADE_PATTERNS,
  RISK_PATTERNS,
  MIN_PRICE_YEN,
  MIN_RAW_JOBS,
  MIN_CANDIDATES,
  S_RANK_KEYWORDS,
  A_RANK_KEYWORDS,
  YUKI_STRENGTHS,
  STRENGTH_HINTS,
  MAX_JOBS: 10,
  MAX_HOLDS: 15,
  SEARCH_DELAY_MS: 2000,
};
