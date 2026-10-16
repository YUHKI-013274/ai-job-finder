// 案件本文（全文）から、応募可否・契約条件に関わる重要事項を機械的に検出する（AI不使用・正規表現のみ）。
//   - 年齢条件（応募者自身の年齢・年代を求める表現。読者層の説明は除く）
//   - 特殊な応募方式（応募画面の条件欄への指定入力、外部フォーム、必ず記載する語など）
//   - 稼働条件（「週N時間以上」「平日9〜17時」など具体的な拘束）
//   - 必須提出物（ポートフォリオ・制作実績の提示が必須で、その種類が分かるもの）
// 検出した結果は「要確認」の判断材料にするだけで、案件を自動で除外はしない。
// Knowledge・評価スコアは参照しない（種類ごとの手持ち資産の対応表だけをここに持つ）。

function normalizeDigits(str) {
  return String(str || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function toLines(text) {
  return normalizeDigits(text).split(/\r?\n/).map(l => l.trim());
}

function excerpt(line, max = 70) {
  const s = String(line || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ===== 年齢条件 =====
// hard：応募者自身の年齢・年代を限定／中心にする表現（例：「20代〜30代前半の方」「20代の方中心」「30歳以下」）
// soft：歓迎レベルの表現（例：「20代歓迎」）。要確認にはせず、注意として残す。
// 「20代向けメディア」「20代が読んで」等の読者層の説明は対象にしない（「の方」を伴わないため一致しない）。
const AGE_HARD_PATTERNS = [
  /\d{2}\s*代(?:\s*[〜~～\-－]\s*\d{2}\s*代)?\s*(?:前半|後半)?\s*(?:の方|の人|の女性|の男性)(?!\s*(?:に向け|向け|が読|へ))/,
  /\d{2}\s*代(?:\s*[〜~～\-－]\s*\d{2}\s*代)?\s*(?:前半|後半)?\s*(?:限定|のみ|まで|に限る|に限ります)/,
  /\d{2}\s*歳\s*(?:以上|以下|未満|まで|から|〜|~)/,
  /年齢\s*(?:制限|条件)\s*[:：]?\s*(?!なし|不問|無し|ありません)\S/,
];
const AGE_SOFT_PATTERNS = [/\d{2}\s*代\s*(?:歓迎|優遇|大歓迎)/];

function detectAgeCondition(text) {
  const lines = toLines(text);
  let soft = null;
  for (const line of lines) {
    if (/年齢[^。\n]{0,6}(?:不問|問いません|制限なし)/.test(line)) continue;
    for (const re of AGE_HARD_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      // 「20代の方歓迎」のように直後が歓迎表現なら、限定ではなく歓迎レベルとして扱う
      const after = line.slice(m.index + m[0].length);
      if (/^\s*[（(]?\s*(?:歓迎|優遇|大歓迎)/.test(after)) {
        if (!soft) soft = { detected: true, level: 'soft', matched: m[0], excerpt: excerpt(line) };
        continue;
      }
      return { detected: true, level: 'hard', matched: m[0], excerpt: excerpt(line) };
    }
  }
  if (soft) return soft;
  for (const line of lines) {
    for (const re of AGE_SOFT_PATTERNS) {
      const m = line.match(re);
      if (m) return { detected: true, level: 'soft', matched: m[0], excerpt: excerpt(line) };
    }
  }
  return { detected: false, level: null, matched: null, excerpt: null };
}

// ===== 特殊な応募方式 =====
const SPECIAL_APPLY_PATTERNS = [
  /新しい条件を提示/,
  /固定報酬で\s*[\d,]+\s*円/,
  /と入力して(?:ご)?応募/,
  /(?:Google\s*フォーム|グーグルフォーム|別途[^。\n]{0,12}フォーム|フォームに(?:ご)?(?:回答|入力))/,
  /件名に[^。\n]{0,30}(?:記載|入力)/,
  /(?:合言葉|キーワード)[^。\n]{0,20}(?:記載|入力|添え)/,
  /応募(?:時|の際)[^。\n]{0,40}(?:必ず|かならず)[^。\n]{0,30}(?:記載|入力|明記)/,
];

function detectSpecialApplyMethod(text) {
  const lines = toLines(text);
  const found = [];
  for (const line of lines) {
    if (SPECIAL_APPLY_PATTERNS.some(re => re.test(line))) found.push(excerpt(line));
    if (found.length >= 2) break;
  }
  return { detected: found.length > 0, excerpts: found };
}

// ===== 稼働条件（具体的な拘束のみ。「週3時間程度」等の目安は対象外） =====
const WORK_CONSTRAINT_PATTERNS = [
  /(?:平日|土日|毎日|月[〜~～-]金)[^。\n]{0,12}\d{1,2}\s*[時:：]\s*[〜~～-]\s*\d{1,2}\s*[時:：]?/,
  /\d{1,2}\s*時\s*[〜~～-]\s*\d{1,2}\s*時[^。\n]{0,10}(?:稼働|対応|勤務|連絡)/,
  /(?:曜日|時間帯)[^。\n]{0,6}(?:固定|指定)/,
  /カメラ[^。\n]{0,8}必須|必須[^。\n]{0,8}カメラ/,
];

// 「週N時間以上」はN>=10、「週N日以上」はN>=3 のときだけ具体的な拘束とみなす（「週1日以上からご相談可能」等は対象外）。
function hasWeeklyMinimum(line) {
  if (/ご?相談|応相談|調整可/.test(line)) return false;
  const h = line.match(/週\s*(\d+)\s*時間\s*以上/);
  if (h && Number(h[1]) >= 10) return true;
  const d = line.match(/週\s*(\d+)\s*日\s*以上/);
  return !!(d && Number(d[1]) >= 3);
}

function detectWorkConstraint(text) {
  const lines = toLines(text);
  const found = [];
  for (const line of lines) {
    if (hasWeeklyMinimum(line) || WORK_CONSTRAINT_PATTERNS.some(re => re.test(line))) found.push(excerpt(line));
    if (found.length >= 2) break;
  }
  return { detected: found.length > 0, excerpts: found };
}

// ===== 資格・職業・属性・経験の限定（明確な応募資格の不一致） =====
// 「施工管理の経験が2年以上ある方に限る」「保育士さん募集」「専門家募集」のように、応募者の資格・職業・属性を
// 限定する明確な表現。ゆうきの確認済みの経歴領域（飲食・店舗運営・マネジメント・資料作成等）と重なる語を含む行は、
// 除外せず「要確認」にとどめる。
const QUALIFICATION_PATTERNS = [
  /\d+\s*年以上[^。\n]{0,20}(?:に限る|に限ります|限定|のみ|必須)/,
  /(?:保育士|看護師|医師|薬剤師|栄養士|教員|弁護士|税理士|社労士|施工管理|建築士|介護士|美容師)[^。\n]{0,15}(?:に限る|に限ります|限定|のみ|必須|経験者)/,
  /【[^】]{0,6}(?:専門家|有資格者|現役[^】]{1,8}|(?:保育士|看護師|医師|薬剤師|栄養士|介護士|美容師)(?:さん)?)[^】]{0,6}(?:募集|限定)[^】]{0,3}】/,
  /【[^】]{0,4}(?:女性|男性)[^】]{0,10}(?:さん|の方)?募集[^】]{0,3}】/,
];
// 補助金・助成金の申請業務（専門実務。evaluator.jsのSPECIALIZED_SCOPE_PATTERNSと同じ趣旨で、言い換え表記を補う）
QUALIFICATION_PATTERNS.push(/(?:補助金|助成金)[^。\n]{0,8}申請(?:の)?(?:サポート|代行|支援|業務|実務|書類)/);
const KNOWN_BACKGROUND = /(飲食|店舗|店長|マネージャー|マネジメント|プロジェクト|営業資料|提案|資料作成)/;

function detectQualificationMismatch(text) {
  const lines = toLines(text);
  for (const line of lines) {
    for (const re of QUALIFICATION_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      return { detected: true, level: KNOWN_BACKGROUND.test(line) ? 'confirm' : 'mismatch', matched: m[0], excerpt: excerpt(line) };
    }
  }
  return { detected: false, level: null, matched: null, excerpt: null };
}

// ===== 必須の経験（応募条件の見出しの下に「〜の経験がある方」と明記されているもの） =====
// 提案資料・記事など、登録済みの手持ち資産でカバーできる種類（DELIVERABLE_TYPESのcoveredBy）が明記されている場合は
// 対象にしない。種類が特定できない／手持ち資産が無い種類の場合は、満たすかどうかの確認事項として検出する。
const REQ_EXP_HEADING = /(必須スキル|必須条件|必須要件|応募条件|応募資格|応募要件)/;
const REQ_EXP_LINE = /(経験(?:が|の)?(?:ある|あり|お持ち|豊富)|経験者|実務経験)/;
const REQ_EXP_SOFT = /(歓迎|尚可|あれば|未経験|不問|問わず|なくても|優遇|あると)/;

const REQ_EXP_GENERIC = /(社会人経験|ビジネス経験|職種指定なし|PC操作)/;
// タイトルの「〇〇経験者募集」「【〇〇経験者】」は、経験者に限る募集（「経験者歓迎」は対象外）
const REQ_EXP_TITLE = /(?:【[^】]{0,20}経験者(?:募集)?[^】歓]{0,6}】|[^\s【】、。]{2,14}経験者募集)/;

function detectRequiredExperience(text) {
  const lines = toLines(text);
  const title = lines[0] || '';
  const tm = title.match(REQ_EXP_TITLE);
  if (tm && !/経験者(?:大)?歓迎|経験者優遇/.test(title) && !(matchDeliverableTypes(tm[0]).length > 0 && matchDeliverableTypes(tm[0]).every(t => t.coveredBy.length > 0))) {
    return { detected: true, excerpt: excerpt(tm[0]) };
  }
  for (let i = 0; i < lines.length; i++) {
    if (!REQ_EXP_HEADING.test(lines[i])) continue;
    for (let j = i; j < Math.min(lines.length, i + 7); j++) {
      const line = lines[j];
      if (!REQ_EXP_LINE.test(line) || REQ_EXP_SOFT.test(line) || REQ_EXP_GENERIC.test(line)) continue;
      const types = matchDeliverableTypes(line);
      if (types.length > 0 && types.every(t => t.coveredBy.length > 0)) continue; // 手持ち資産でカバーできる種類
      return { detected: true, excerpt: excerpt(line) };
    }
  }
  return { detected: false, excerpt: null };
}

// ===== 必須提出物（制作実績・ポートフォリオ）と、手持ち資産との突合 =====
// coveredBy：その種類をカバーする「登録済みの手持ち資産名」（knowledge/yuki_portfolio.js・Application Packetの
// 資産名と同じ表記）。空配列＝提示できる同種の作品が無い。action：不足を補う具体的な行動。
const DELIVERABLE_TYPES = [
  {
    id: 'price_menu', label: 'メニュー表・価格表・カタログ',
    patterns: ['メニュー表', '価格表', '料金表', '価格リスト', '商品カタログ', 'カタログ'],
    coveredBy: [],
    action: 'メニュー表または価格表のサンプルを1点自主制作し、画像制作ポートフォリオ（/design）に追加してから応募する',
  },
  {
    id: 'sales_copy', label: 'LP・ステップメール・セールスレター',
    patterns: ['LP', 'ランディングページ', 'セールスレター', 'ステップメール', 'メルマガ', 'セールスライティング', 'セールスコピー'],
    coveredBy: [],
    action: 'LP原稿またはステップメールのサンプルを1本自主制作し、ライティングポートフォリオ（/writing）に追加してから応募する',
  },
  {
    id: 'manual', label: 'マニュアル・手順書',
    patterns: ['マニュアル', '手順書'],
    coveredBy: [],
    action: 'マニュアルのサンプルを1点自主制作し、資料制作ポートフォリオ（/improvement）に追加してから応募する',
  },
  {
    id: 'article', label: '記事・ライティング',
    patterns: ['記事', 'ブログ', 'コラム', 'ライティング', 'SEO'],
    coveredBy: ['AIライティング5記事'],
    action: null,
  },
  {
    id: 'proposal', label: '提案書・営業資料・スライド',
    patterns: ['提案書', '提案資料', '企画書', '営業資料', 'スライド', 'PowerPoint', 'パワーポイント'],
    coveredBy: ['飲食事業改善 提案資料'],
    action: null,
  },
  {
    id: 'image', label: 'バナー・画像制作',
    patterns: ['バナー', 'サムネ', 'Instagram', 'インスタ', '画像制作', 'イラスト'],
    coveredBy: ['AI画像5作品'],
    action: null,
  },
];

function matchDeliverableTypes(text) {
  return DELIVERABLE_TYPES.filter(t => t.patterns.some(p => String(text).includes(p)));
}

const SUBMISSION_NOUN = /(ポートフォリオ|制作実績|作品|サンプル|実績)/;
const SUBMISSION_VERB = /(添付|提出|提示|ご提示|ご提出|送付|URL|拝見|お見せ)/;
const OPTIONAL_MARK = /(あれば|あると|任意|歓迎|できれば|可能であれば|お持ちの場合|お持ちであれば)/;
const REQUIRED_CONTEXT = /(必須|必ず|応募条件|応募資格|応募時|応募の際|選考)/;

function detectRequiredSubmission(text) {
  const lines = toLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SUBMISSION_NOUN.test(line) || !SUBMISSION_VERB.test(line) || OPTIONAL_MARK.test(line)) continue;
    const around = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
    if (!(REQUIRED_CONTEXT.test(line) || REQUIRED_CONTEXT.test(around))) continue;
    // 種類の判定は、提出を求める行とその前後（実績の種類が前の行に書かれる形式が多い）で行う
    const window = lines.slice(Math.max(0, i - 2), i + 2).join('\n');
    const types = matchDeliverableTypes(window);
    const specific = types.filter(t => ['price_menu', 'sales_copy', 'manual'].includes(t.id));
    const target = specific.length > 0 ? specific : types;
    const uncovered = target.filter(t => t.coveredBy.length === 0);
    return {
      required: true,
      excerpt: excerpt(line),
      types: target.map(t => ({ id: t.id, label: t.label, covered: t.coveredBy.length > 0 })),
      uncovered: uncovered.map(t => ({ id: t.id, label: t.label, action: t.action })),
    };
  }
  return { required: false, excerpt: null, types: [], uncovered: [] };
}

// 案件の全文（タイトル＋本文）から、選定に使う重要事項をまとめて検出する
function detectSelectionSignals(title, description) {
  const text = `${title || ''}\n${description || ''}`;
  return {
    age: detectAgeCondition(text),
    specialApply: detectSpecialApplyMethod(text),
    workConstraint: detectWorkConstraint(text),
    qualification: detectQualificationMismatch(text),
    requiredExperience: detectRequiredExperience(text),
    requiredSubmission: detectRequiredSubmission(text),
  };
}

module.exports = {
  DELIVERABLE_TYPES,
  detectAgeCondition,
  detectSpecialApplyMethod,
  detectWorkConstraint,
  detectQualificationMismatch,
  detectRequiredExperience,
  detectRequiredSubmission,
  detectSelectionSignals,
};
