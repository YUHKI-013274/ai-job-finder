// Knowledge駆動の3段階判定（応募可能／チャレンジ可能／対応不可）— v2
//
// yuki_profile.js（Sales Knowledge / Common Knowledge由来の構造化プロフィール）を参照し、
// 案件テキストを「対応可能業務」「チャレンジ可能業務」「対応不可業務・非希望領域」に照らして判定する。
//
// v2での変更点（監査結果への対応）:
//   - 案件の主タスク（TASK_CATEGORIES）とテーマ・業界経験（DOMAIN_EXPERIENCES）を分離して判定する。
//     テーマ経験（飲食業22年等）は、対応するトリガー語が実際に案件文へ含まれる場合のみ
//     「追加根拠」として判定理由に加える。単独でcapabilityStatusやevidenceTypeを決定しない。
//   - 判定理由（capabilityReason）・不足証拠（missingEvidence）は、案件に該当する要素
//     （テーマ経験／成果物経験／受注実績／自主制作物／転用可能能力／使用可能ツール）だけを
//     組み合わせて動的に生成する（定型文の使い回しをしない）。

const { INDUSTRY_MISMATCH_PATTERNS, AI_TECHNICAL_KEYWORDS, GROWTH_DISQUALIFYING_PATTERNS } = require('./config');

function matchPatternList(text, patterns) {
  if (!patterns || patterns.length === 0) return [];
  const lower = text.toLowerCase();
  return patterns.filter(p => lower.includes(String(p).toLowerCase()));
}

// EXCLUDED_AREAS / DOMAIN_EXPERIENCESの useConfigPatterns 指定を実際のconfig.js配列に解決する
const CONFIG_PATTERN_SOURCES = { AI_TECHNICAL_KEYWORDS, GROWTH_DISQUALIFYING_PATTERNS };

function resolveAreaPatterns(area) {
  if (area.useConfigPatterns) return CONFIG_PATTERN_SOURCES[area.useConfigPatterns] || [];
  return area.patterns || [];
}

function findFirstMatch(text, list, patternsKey = 'patterns') {
  for (const entry of list) {
    const matched = matchPatternList(text, entry[patternsKey]);
    if (matched.length > 0) return { entry, matchedPatterns: matched };
  }
  return null;
}

// 案件テキストが能力辞典の各能力の「依頼される作業・成果物」を表す語（signals）と
// 一致するかを見る（タスクカテゴリーのいずれにも一致しなかった場合の救済判定用）。
// 修正前は def.substituteFor（人が読むための説明文）をそのまま案件文と部分一致させて
// いたため実質的に一致することがなかった（監査で発見・0件稼働の不具合）。
// signalsは実際の求人語彙（デザイナー募集／投稿制作／リサーチャー等）を保持する
// 独立フィールドとして能力辞典側に追加し、単語・複合語レベルで判定する。
function findCapabilityConnections(text, capabilities) {
  const connections = [];
  for (const [name, def] of Object.entries(capabilities)) {
    const matched = matchPatternList(text, def.signals);
    if (matched.length > 0) connections.push({ name, def, matchedPatterns: matched });
  }
  return connections;
}

// 能力接続が、既存タスクカテゴリー（TASK_CATEGORIES）のいずれかの必須能力群と
// 複数一致する場合、そのカテゴリーを「構造的に強い接続」とみなして証拠を借用できるようにする。
// 1能力のみの接続は、単独のタスクカテゴリーへ断定せず確認候補として扱う（過剰な自動昇格を避ける）。
function findStronglyConnectedCategory(connections, taskCategories) {
  const connectedNames = new Set(connections.map(c => c.name));
  let best = null;
  for (const category of taskCategories) {
    const overlap = category.requiredCapabilities.filter(c => connectedNames.has(c));
    if (overlap.length >= 2 && (!best || overlap.length > best.overlap.length)) {
      best = { category, overlap };
    }
  }
  return best;
}

// テーマ・業界経験（ドメイン）の一致を判定する。トリガー語が実際に含まれる場合のみ返す。
function findDomainMatch(text, domainExperiences) {
  for (const domain of domainExperiences) {
    const matched = matchPatternList(text, domain.triggers);
    if (matched.length > 0) return { domain, matchedPatterns: matched };
  }
  return null;
}

// カテゴリーの証拠（成果物／受注実績）の有無から、直接証明／強い代替証明／弱い代替証明を判定する。
// tier='available'（主戦場）は成果物と受注実績の両方があれば直接証明、片方のみなら強い代替証明。
// tier='challenge'（成長領域）は両方あっても強い代替証明が上限（Sales Knowledge自身が
// 成長領域と位置づけているカテゴリーを、証拠の量だけで主戦場相当に格上げしない）。
function computeEvidenceType({ tier, hasDeliverable, hasPaid, industryMismatch }) {
  let level;
  if (tier === 'available') {
    if (hasPaid && hasDeliverable) level = 3; // 直接証明
    else if (hasPaid || hasDeliverable) level = 2; // 強い代替証明
    else level = 1; // 弱い代替証明
  } else {
    if (hasPaid && hasDeliverable) level = 2; // 強い代替証明（成長領域の上限）
    else if (hasPaid || hasDeliverable) level = 1; // 弱い代替証明
    else level = 0; // 証明不足
  }
  if (industryMismatch && level === 3) level = 2; // 業界不一致は直接証明から1段階下げる
  return ['証明不足', '弱い代替証明', '強い代替証明', '直接証明'][level];
}

// 判定理由を、案件に実際に該当する要素だけを組み合わせて動的に生成する（定型文の使い回しをしない）。
function buildCapabilityReason({ capabilityStatus, category, domainMatch, evidenceType }) {
  const clauses = [];
  const headLabel = capabilityStatus === '対応不可'
    ? null
    : (capabilityStatus === '応募可能' ? '対応可能業務' : 'チャレンジ可能業務');

  if (headLabel) clauses.push(`${headLabel}「${category.label}」に該当`);

  const evidenceClauses = [];
  if (domainMatch) evidenceClauses.push(`テーマ理解として${domainMatch.domain.text}`);
  if (category.deliverableEvidence) evidenceClauses.push(`制作実績として${category.deliverableEvidence}`);
  if (category.paidExperience) evidenceClauses.push(`受注・実務経験として${category.paidExperience}`);
  if (category.toolsUsed && category.toolsUsed.length > 0) evidenceClauses.push(`使用可能ツール（${category.toolsUsed.join('・')}）を活用`);

  if (evidenceClauses.length > 0) {
    clauses.push(`${evidenceClauses.join('、')}を根拠に${evidenceType}と判定`);
  } else {
    clauses.push(`能力辞典上の転用可能な能力（${category.requiredCapabilities.join('・')}）のみを根拠に${evidenceType}と判定`);
  }

  clauses.push(capabilityStatus === '応募可能' ? '応募可能と判定' : '実績獲得目的の応募候補と判定');
  return clauses.join('。') + '。';
}

// 不足している証拠を、案件に該当する項目だけから具体的に抽出する（存在しない実績の補完はしない）。
function buildMissingEvidence({ category, capabilityStatus }) {
  const missing = [];
  if (!category.paidExperience) missing.push(`「${category.label}」に対応する外部受注・納品実績はSales Knowledge上まだない`);
  if (!category.deliverableEvidence) missing.push(`「${category.label}」に対応する完成済み制作物はSales Knowledge上まだない`);
  if (capabilityStatus === 'チャレンジ可能') missing.push('同一ジャンル・同一クライアントでの受注実績はまだ少ない');
  return missing;
}

/**
 * 案件テキスト（タイトル+本文、正規化・否定表現除去済み）を分類する。
 * @returns {{
 *   capabilityStatus: '応募可能'|'チャレンジ可能'|'確認候補'|'対応不可',
 *   evidenceType: '直接証明'|'強い代替証明'|'弱い代替証明'|'証明不足',
 *   capabilityReason: string,
 *   matchedCapabilities: string[],
 *   missingEvidence: string[],
 *   decisionSource: string,
 *   matchedCategory: object|null,
 *   domainExperience: string|null,
 *   undecidedReason: string|null,
 * }}
 */
function classifyCapability(text, profile) {
  // 1. 対応不可業務・非希望領域（動画編集・大規模システム開発・不動産・単純作業等）を最優先で判定。
  //    パターンは「動画編集」等の動詞を伴う複合語のみで、「動画」単独では一致しないため、
  //    「動画シナリオ作成」等の文章タスクを誤って除外することはない。
  for (const area of profile.excludedAreas) {
    const patterns = resolveAreaPatterns(area);
    const matched = matchPatternList(text, patterns);
    if (matched.length > 0) {
      return {
        capabilityStatus: '対応不可',
        evidenceType: '証明不足',
        capabilityReason: `対応不可業務・非希望領域「${area.label}」に該当するため対応不可と判定`,
        matchedCapabilities: [],
        missingEvidence: [`「${area.label}」はSales Knowledgeで対象外と明記されている領域`],
        decisionSource: area.decisionSource,
        matchedCategory: null,
        domainExperience: null,
        undecidedReason: null,
      };
    }
  }

  // 2. テーマ・業界経験（ドメイン）の一致を先に調べておく（主タスクとは独立して判定し、
  //    後で該当カテゴリーに"追加根拠"として併記するだけに使う）。
  const domainMatch = findDomainMatch(text, profile.domainExperiences);

  // 3. タスクカテゴリー（対応可能・チャレンジ可能を問わず優先順位付き単一リスト）を判定する。
  //    「ライター募集」等の職種語は、テーマ一致（飲食）より先にここで正しく一致する。
  const taskMatch = findFirstMatch(text, profile.taskCategories);
  if (taskMatch) {
    const category = taskMatch.entry;
    const capabilityStatus = category.tier === 'available' ? '応募可能' : 'チャレンジ可能';
    const industryMismatchMatches = matchPatternList(text, INDUSTRY_MISMATCH_PATTERNS);
    const evidenceType = computeEvidenceType({
      tier: category.tier,
      hasDeliverable: !!category.deliverableEvidence,
      hasPaid: !!category.paidExperience,
      industryMismatch: industryMismatchMatches.length > 0,
    });
    const missingEvidence = buildMissingEvidence({ category, capabilityStatus });
    if (industryMismatchMatches.length > 0) {
      missingEvidence.push(`成果物の形式・業務内容は近いが、業界（${industryMismatchMatches[0]}）が実績と異なるため直接証明にはならない`);
    }
    return {
      capabilityStatus,
      evidenceType,
      capabilityReason: buildCapabilityReason({ capabilityStatus, category, domainMatch, evidenceType }),
      matchedCapabilities: category.requiredCapabilities,
      missingEvidence,
      decisionSource: domainMatch
        ? `${category.decisionSource}（テーマ根拠: ${domainMatch.domain.decisionSource}）`
        : category.decisionSource,
      matchedCategory: category,
      domainExperience: domainMatch ? domainMatch.domain.text : null,
      undecidedReason: null,
    };
  }

  // 4. どのタスクカテゴリーにも一致しなかった場合、能力辞典の救済判定を行う。
  //    案件文に含まれる「依頼される作業・成果物」語（signals）から接続する能力を洗い出し、
  //    その能力群が既存タスクカテゴリーの必須能力と複数一致する場合のみ、そのカテゴリーの
  //    証拠を借用して応募可能／チャレンジ可能とする（過剰な自動昇格を避けるため、
  //    単一能力のみの接続は断定せず確認候補に回す）。
  const connections = findCapabilityConnections(text, profile.capabilities);
  if (connections.length > 0) {
    const strong = findStronglyConnectedCategory(connections, profile.taskCategories);
    if (strong) {
      const category = strong.category;
      const capabilityStatus = category.tier === 'available' ? '応募可能' : 'チャレンジ可能';
      const industryMismatchMatches = matchPatternList(text, INDUSTRY_MISMATCH_PATTERNS);
      // 能力辞典経由の救済は、タスクカテゴリーのpatternsに直接一致した場合より1段階弱い証拠として扱う
      // （案件文の言い回しからの推定であり、案件の中心業務そのものと確認できたわけではないため）。
      const evidenceType = industryMismatchMatches.length > 0 ? '弱い代替証明' : '強い代替証明';
      const missingEvidence = buildMissingEvidence({ category, capabilityStatus });
      missingEvidence.push(`「${category.label}」の案件辞典パターンとは直接一致せず、能力辞典（${strong.overlap.join('・')}）からの推定のため、案件詳細で業務内容を確認すること`);
      return {
        capabilityStatus,
        evidenceType,
        capabilityReason: `案件辞典の主要カテゴリーには直接一致しないが、案件文から接続する能力（${strong.overlap.join('・')}）が「${category.label}」の必須能力と複数一致するため、能力辞典フォールバックにより${capabilityStatus}と判定`,
        matchedCapabilities: strong.overlap,
        missingEvidence,
        decisionSource: `Sales Knowledge 4章（能力辞典フォールバック）→ ${category.decisionSource}`,
        matchedCategory: category,
        domainExperience: domainMatch ? domainMatch.domain.text : null,
        undecidedReason: null,
      };
    }

    // 能力接続は1つ以上あるが、既存タスクカテゴリーへ複数一致で断定できない＝確認候補。
    const connectedNames = connections.map(c => c.name);
    return {
      capabilityStatus: '確認候補',
      evidenceType: '証明不足',
      capabilityReason: `案件辞典の主要カテゴリーには一致しないが、案件文に転用可能な能力（${connectedNames.join('・')}）に関連する語（${connections.map(c => c.matchedPatterns[0]).join('・')}）が含まれており、対応可能とも対応不可とも断定できないため確認候補と判定`,
      matchedCapabilities: connectedNames,
      missingEvidence: ['この案件テーマに直結する案件辞典カテゴリーがSales Knowledgeになく、依頼される作業内容・成果物の詳細が案件本文からしか確認できない'],
      decisionSource: 'Sales Knowledge 4章（能力辞典）※単一能力接続のため断定せず確認候補',
      matchedCategory: null,
      domainExperience: domainMatch ? domainMatch.domain.text : null,
      undecidedReason: `転用可能な能力（${connectedNames.join('・')}）との関連語は見つかったが、案件の中心業務・必須条件が案件文だけでは確定できない`,
    };
  }

  return {
    capabilityStatus: '対応不可',
    evidenceType: '証明不足',
    capabilityReason: '対応可能業務・チャレンジ可能業務のいずれにも該当せず、能力辞典上の転用可能な関連もSales Knowledgeで確認できないため対応不可と判定',
    matchedCapabilities: [],
    missingEvidence: ['この職種に直接・間接的に対応する経験・実績・能力がSales Knowledgeに見当たらない'],
    decisionSource: 'Sales Knowledge 1-4（証明できない案件の判断方法）',
    matchedCategory: null,
    domainExperience: null,
    undecidedReason: null,
  };
}

module.exports = { classifyCapability };
