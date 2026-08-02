// ゆうき基本情報プロフィール（構造化データ）— Stage1用
//
// 生成元（このファイルはCommon Knowledgeからの派生データであり、Knowledge本体は変更しない）:
//   C:\Users\nagam\knowledge\06_common_knowledge\yuki_common_knowledge.md（最終更新 2026-07-11）
//
// yuki_profile.js（Sales Knowledge由来）と同じ設計方針：markdownを都度LLMで解釈するのではなく、
// これまでのフェーズで検証済みの構造化データとして参照する。氏名・稼働条件・使用ツール・価値観など
// 「本人基本情報の確認」に限定し、営業判断（経験・能力・証拠・案件分類）はyuki_profile.js側を使う。
//
// 記載のない情報（年齢・居住地・家族構成等）はCommon Knowledge自身が「本ファイルに記載がない限り
// 出力しない」と明記しているため、このファイルにも追加しない（=Stage1ではrequires_confirmationとして扱う）。

const BASIC_PROFILE = {
  name: '永峯勇気',
  nameReading: 'ながみね ゆうき',
  email: 'nagamine0940@gmail.com',
  currentJob: 'タクシードライバー（フルタイム勤務）',
};

// 案件の「稼働時間・曜日条件」判定に使う。具体的な1日あたりの対応可能時間はCommon Knowledgeに
// 記載がないため、ここにも追加しない（Stage1のmissingInformationで都度確認する）。
const WORK_CONSTRAINTS = {
  summary: '本業（タクシードライバー・フルタイム）と並行した副業フェーズ。フルタイム勤務 + 空き時間でAI活動',
  fullTimeElsewhere: true,
  dailyAvailableHours: null, // Common Knowledgeに具体的時間の記載なし。応募文作成前に都度確認が必要
  source: 'yuki_common_knowledge.md セクション1・15',
};

// Sales Knowledge（yuki_profile.js）のAVAILABLE_TOOLSと突き合わせるための、Common Knowledge側の
// 使用ツール一覧。矛盾チェック用に両方保持する。
const AVAILABLE_TOOLS = ['ChatGPT', 'Claude Code', 'Dify'];

const VALUES = {
  brandStatement: '自分らしく生きることは、人生を愉快にする。',
  brandCopy: '余裕は、人の可能性を解き放つ。',
  tone: '親しみやすい・正直・飾らない・自然体',
  cherish: '等身大・再現性・継続できること',
  avoid: '過度な煽り・無理をすすめる表現・短期収益だけの切り口・強い売り込み感',
  keywords: ['自然体', '余裕', '本質', '温もり', '安心', '誠実', '流れ', '成長', '愉快'],
  source: 'yuki_common_knowledge.md セクション9・16',
};

// Common Knowledgeが明示的に「記載がない限り出力しない」としている項目。
// Stage1はこれらを推測せず、案件がこれらを問う場合は requires_confirmation として扱う。
const UNDISCLOSED_FIELDS = ['年齢', '居住地', '家族構成', '具体的な店舗名・企業名', '具体的な売上・人数の数値'];

module.exports = {
  sourceVersion: 'yuki_common_knowledge.md（最終更新 2026-07-11）',
  // Common Knowledge本体（C:\Users\nagam\knowledge\06_common_knowledge\yuki_common_knowledge.md）の
  // 内容から算出したsha256ハッシュ（転記時点）。knowledge-sync-check.js が照合する。
  sourceContentHash: 'e478611d880922951e39517d5b42f863e2b5aaaefebc106e1573ad94cb0154be',
  basicProfile: BASIC_PROFILE,
  workConstraints: WORK_CONSTRAINTS,
  availableTools: AVAILABLE_TOOLS,
  values: VALUES,
  undisclosedFields: UNDISCLOSED_FIELDS,
};
