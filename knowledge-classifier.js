// Knowledge駆動の3段階判定（応募可能／チャレンジ可能／対応不可）
//
// yuki_profile.js（Sales Knowledge / Common Knowledge由来の構造化プロフィール）を参照し、
// 案件テキストを「対応可能業務」「チャレンジ可能業務」「対応不可業務・非希望領域」に照らして判定する。
// config.jsの固定パターン配列（CATEGORY_TIERS等）は補助判定として引き続き evaluator.js 側で使うが、
// ここでの判定（capabilityStatus）が最終判断として優先される。

const { INDUSTRY_MISMATCH_PATTERNS, AI_TECHNICAL_KEYWORDS, GROWTH_DISQUALIFYING_PATTERNS } = require('./config');

function matchPatternList(text, patterns) {
  if (!patterns || patterns.length === 0) return [];
  const lower = text.toLowerCase();
  return patterns.filter(p => lower.includes(String(p).toLowerCase()));
}

// EXCLUDED_AREAS の useConfigPatterns 指定を実際のconfig.js配列に解決する
const CONFIG_PATTERN_SOURCES = {
  AI_TECHNICAL_KEYWORDS,
  GROWTH_DISQUALIFYING_PATTERNS,
};

function resolveAreaPatterns(area) {
  if (area.useConfigPatterns) return CONFIG_PATTERN_SOURCES[area.useConfigPatterns] || [];
  return area.patterns || [];
}

function findFirstCategoryMatch(text, categories) {
  for (const category of categories) {
    const matched = matchPatternList(text, category.patterns);
    if (matched.length > 0) return { category, matchedPatterns: matched };
  }
  return null;
}

function findExcludedAreaMatch(text, excludedAreas) {
  for (const area of excludedAreas) {
    const patterns = resolveAreaPatterns(area);
    const matched = matchPatternList(text, patterns);
    if (matched.length > 0) return { area, matchedPatterns: matched };
  }
  return null;
}

// 案件テキストが能力辞典の各能力の「代替証明として使える案件」と緩やかに関連するかを見る
// （案件カテゴリーが対応可能／チャレンジ可能のいずれにも一致しなかった場合の最終フォールバック判定用）
function findLooseCapabilityHint(text, capabilities) {
  const hints = [];
  for (const [name, def] of Object.entries(capabilities)) {
    if (def.substituteFor && text.includes(def.substituteFor)) hints.push(name);
  }
  return hints;
}

/**
 * 案件テキスト（タイトル+本文、正規化・否定表現除去済み）を分類する。
 * @returns {{
 *   capabilityStatus: '応募可能'|'チャレンジ可能'|'対応不可',
 *   evidenceType: '直接証明'|'強い代替証明'|'弱い代替証明'|'証明不足',
 *   capabilityReason: string,
 *   matchedCapabilities: string[],
 *   missingEvidence: string[],
 *   decisionSource: string,
 *   matchedCategory: object|null,
 * }}
 */
function classifyCapability(text, profile) {
  // 1. 対応不可業務・非希望領域（Sales Knowledge 2-3 / 5-4）を最優先で判定
  const excludedMatch = findExcludedAreaMatch(text, profile.excludedAreas);
  if (excludedMatch) {
    return {
      capabilityStatus: '対応不可',
      evidenceType: '証明不足',
      capabilityReason: `対応不可業務・非希望領域「${excludedMatch.area.label}」に該当するため対応不可と判定`,
      matchedCapabilities: [],
      missingEvidence: [`「${excludedMatch.area.label}」はSales Knowledgeで対象外と明記されている領域`],
      decisionSource: excludedMatch.area.decisionSource,
      matchedCategory: null,
    };
  }

  // 2. 対応可能業務（主戦場）判定
  const availableMatch = findFirstCategoryMatch(text, profile.availableCategories);
  if (availableMatch) {
    const { category } = availableMatch;
    const industryMismatchMatches = matchPatternList(text, INDUSTRY_MISMATCH_PATTERNS);
    let evidenceType = '直接証明';
    const missingEvidence = [];
    if (industryMismatchMatches.length > 0) {
      evidenceType = '強い代替証明';
      missingEvidence.push(`成果物の形式・業務内容は近いが、業界（${industryMismatchMatches[0]}）が実績と異なるため直接証明にはならない`);
    }
    return {
      capabilityStatus: '応募可能',
      evidenceType,
      capabilityReason: `対応可能業務「${category.label}」に該当し、${evidenceType}（${category.directEvidence}）があるため応募可能と判定`,
      matchedCapabilities: category.requiredCapabilities,
      missingEvidence,
      decisionSource: category.decisionSource,
      matchedCategory: category,
    };
  }

  // 3. チャレンジ可能業務（成長領域）判定
  const challengeMatch = findFirstCategoryMatch(text, profile.challengeCategories);
  if (challengeMatch) {
    const { category } = challengeMatch;
    const industryMismatchMatches = matchPatternList(text, INDUSTRY_MISMATCH_PATTERNS);
    const evidenceType = industryMismatchMatches.length > 0 ? '弱い代替証明' : '強い代替証明';
    return {
      capabilityStatus: 'チャレンジ可能',
      evidenceType,
      capabilityReason: `チャレンジ可能業務「${category.label}」に該当し、${evidenceType}（${category.substituteEvidence}）で中核能力を転用できるため、実績獲得目的の応募候補と判定`,
      matchedCapabilities: category.requiredCapabilities,
      missingEvidence: [category.allowedGap],
      decisionSource: category.decisionSource,
      matchedCategory: category,
    };
  }

  // 4. どちらのカテゴリにも一致しない場合：能力辞典レベルの緩やかな一致だけを見て、
  //    それすらなければ「証明不足」として対応不可とする（Sales Knowledge 1-4 応募非推奨）
  const looseHints = findLooseCapabilityHint(text, profile.capabilities);
  if (looseHints.length > 0) {
    return {
      capabilityStatus: 'チャレンジ可能',
      evidenceType: '弱い代替証明',
      capabilityReason: `案件辞典の主要カテゴリには一致しないが、転用可能な能力（${looseHints.join('・')}）が能力辞典の代替証明範囲に該当するため、チャレンジ可能と判定`,
      matchedCapabilities: looseHints,
      missingEvidence: ['この案件テーマに直結する案件辞典カテゴリがSales Knowledgeにないため、応募文で転用方法を具体的に説明する必要がある'],
      decisionSource: 'Sales Knowledge 4章（能力辞典）',
      matchedCategory: null,
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
  };
}

module.exports = { classifyCapability };
