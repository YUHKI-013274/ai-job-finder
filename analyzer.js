// Stage1: 案件分析データ生成
//
// Stage0で保存した案件詳細JSON（data/private/job_details/{jobId}.json）とKnowledgeを照合し、
// 応募文生成へ渡せる分析データ（data/private/job_analysis/{jobId}.json）を生成する。
// 応募文そのものは作らない。外部AI APIは使用しない（すべてルールベース）。
//
// 情報源の優先順位（必ずこの順で参照する）:
//   1. 案件詳細ページの本文・クライアント情報（Stage0保存データ）
//   2. Sales Knowledge（knowledge/yuki_sales_knowledge_v1.md → yuki_profile.js / yuki_job_dictionary.js経由）
//   3. Common Knowledge（yuki_common_knowledge.md → yuki_common_profile.js経由）
//   4. 案件検索システムの判定結果（evaluator.evaluateJobを全文で再評価した結果）
//   5. 今回、永峯勇気から追加された情報（今回は無し）
//
// Knowledgeにない経験・実績・ツール・稼働条件は追加しない。確認できない情報は推測せず
// requires_confirmation として保存する。意味解析が必要な項目は requires_ai_analysis として保存し、
// Stage1では断定しない。
//
// 品質監査（Stage1最終品質監査）を受けた安全性・精度修正を含む：
//   1. stop案件の応募材料を完全抑制（proposalGenerationAllowed）
//   2/3. 要求ツールとKnowledge使用可能ツールの適合判定・証拠レベルの格下げ
//   4. 「商品開発」等の汎用語単独での飲食テーマ誤接続を防止
//   5. 禁止事項・質問文の中にしか出現しない語でのカテゴリー誤判定を防止
//   6. SNS運用代行の除外を、制作/運用の文脈で再判定
//   7. 同一営業資産のassetIdによる重複統合
//   8. 正規Knowledge（Markdown）とJSキャッシュのハッシュ照合（不一致時は処理停止）
//   9. 応募時回答項目の緩やかな検知（見出し不一致でも消失させない）
const { evaluateJob, normalizeFullWidthDigits } = require('./evaluator');
const { classifyCapability } = require('./knowledge-classifier');
const {
  APPLICANT_ATTRIBUTE_EXCLUDE_PATTERNS,
  APPLICANT_ATTRIBUTE_CAUTION_PATTERNS,
  EXPERIENCE_PREFERRED_PATTERNS,
  BEGINNER_PATTERNS,
  CONTINUITY_PATTERNS,
  NEGATION_PATTERNS,
  REQUIRED_TOOL_DISALLOWED,
} = require('./config');
const yukiProfile = require('./knowledge/yuki_profile');
const yukiCommonProfile = require('./knowledge/yuki_common_profile');
const yukiJobDictionary = require('./knowledge/yuki_job_dictionary');
const { verifyKnowledgeSync } = require('./knowledge-sync-check');
const { loadAppliedJobs, loadJobStatus, filterJobStatus, JOB_STATUS } = require('./store');
const { listSavedJobDetailIds, loadJobDetail } = require('./detail-store');
const { saveJobAnalysis } = require('./analysis-store');

const ANALYSIS_VERSION = 'stage1-v2';

function nowIso() {
  return new Date().toISOString();
}

function containsAny(text, patterns) {
  if (!text || !patterns) return [];
  const lower = text.toLowerCase();
  return patterns.filter(p => {
    if (p instanceof RegExp) return p.test(text);
    return lower.includes(String(p).toLowerCase());
  });
}

// ===== 修正8: 正規Knowledge（Markdown）とJSキャッシュの同期確認 =====
// 不一致の場合はStage1処理を停止する（古いキャッシュを黙って使わない）。
class KnowledgeOutOfSyncError extends Error {
  constructor(syncResult) {
    const mismatched = syncResult.results.filter(r => !r.inSync).map(r => `${r.cacheName}（参照元: ${r.sourceLabel}）`);
    super(`正規Knowledge（Markdown）とJSキャッシュが一致していないため、Stage1の分析処理を停止しました。不一致: ${mismatched.join('、')}`);
    this.name = 'KnowledgeOutOfSyncError';
    this.syncResult = syncResult;
  }
}

function assertKnowledgeInSync() {
  const result = verifyKnowledgeSync();
  if (!result.allInSync) {
    throw new KnowledgeOutOfSyncError(result);
  }
  return result;
}

// ===== 対象案件フィルタ（完全に対応不可・募集終了・応募済み・見送り済み・本文取得失敗を除外） =====
// 「明確な対応不可」（Knowledgeの全文再評価で対応不可と判定される案件）はここでは除外しない。
// 分析結果自体（recommendation=stop）としてその判断理由を残すことが、次工程（永峯勇気の最終確認）に
// 必要な情報のため。ここで除外するのは、Stage0時点で確認できる客観的な対象外条件のみ。
function isEligibleForAnalysis(detail, { appliedMap = {}, rejectedMap = {} } = {}) {
  if (!detail) return { eligible: false, reason: '詳細データが存在しない' };
  if (detail.fetch && detail.fetch.status !== 'success') return { eligible: false, reason: '案件詳細の取得に失敗している' };
  if (!detail.description) return { eligible: false, reason: '案件本文が取得できていない' };
  if (!detail.clientSummary) return { eligible: false, reason: 'クライアント情報が取得できていない' };
  if (detail.deadline && detail.deadline.status === 'expired') return { eligible: false, reason: '募集終了' };
  if (appliedMap[detail.jobId]) return { eligible: false, reason: '応募済み' };
  if (rejectedMap[detail.jobId]) return { eligible: false, reason: '見送り済み' };
  return { eligible: true, reason: null };
}

// ===== Stage0詳細JSON → evaluator.evaluateJob() 入力への変換 =====
function buildEvaluatorInput(detail) {
  return {
    id: detail.jobId,
    title: detail.title,
    description: detail.description,
    price: detail.price ? detail.price.raw : null,
    applicants: detail.applicationStats ? detail.applicationStats.applied : null,
    deadlineStatus: detail.deadline ? detail.deadline.status : 'unknown',
    url: detail.url,
  };
}

function stripNegatedPhrasesLocal(str) {
  if (!str) return str;
  let result = String(str);
  for (const pattern of NEGATION_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result;
}

// ===== 修正4: 「商品開発」等の汎用語単独での飲食テーマ接続を防ぐ =====
// 「商品開発」はDOMAIN_EXPERIENCES/hospitality_content双方のトリガー語だが、食品・飲食に限らず
// あらゆる業種で使われる汎用語のため、以下のいずれかが本文に併記されている場合のみ飲食テーマとして扱う。
const FOOD_CONTEXT_CONFIRM_WORDS = ['飲食', '店舗', 'レストラン', 'カフェ', 'メニュー', '食品', '外食', '接客', '店長', '飲食店'];
function hasFoodContextConfirmation(text) {
  return FOOD_CONTEXT_CONFIRM_WORDS.some(w => text.includes(w));
}

// ===== 修正5: 禁止事項等の「業務内容そのものではない文脈」にのみ出現する語でのカテゴリー誤判定を防ぐ =====
// 「応募時の質問」「応募方法」等は対象に含めない：質問文が案件の業務内容（例：資料作成実績の有無を問う）
// と無関係とは限らず、過剰に除外するとjobId 13318382のような正当な証拠（飲食事業改善提案資料等）まで
// 失われてしまう。ここで狙うのは、著作権・禁止事項など業務内容と明確に無関係な文脈のみ。
const EXCLUDED_CONTEXT_SIGNAL = /禁止|アップロード禁止|再利用は禁止|複製禁止|流用禁止|転載禁止|実績として使用不可/;
function isOccurrenceInExcludedContext(text, idx) {
  const windowStart = Math.max(0, idx - 150);
  const before = text.slice(windowStart, idx);
  return EXCLUDED_CONTEXT_SIGNAL.test(before);
}

// カテゴリーの一致に使われた語（patterns）が、すべて禁止事項・質問文などの文脈にしか出現しない場合、
// その一致は信頼できないと判定する（例：「著作権…ブログへのアップロード禁止」の「ブログ」）。
function reverifyCategoryMatch(text, category) {
  if (!category || !category.patterns) return { confident: true, reason: null };
  const lower = text.toLowerCase();
  const occurrences = [];
  for (const pattern of category.patterns) {
    const p = String(pattern).toLowerCase();
    let idx = lower.indexOf(p);
    while (idx !== -1) {
      occurrences.push({ pattern, idx });
      idx = lower.indexOf(p, idx + 1);
    }
  }
  if (occurrences.length === 0) return { confident: true, reason: null }; // 能力辞典フォールバック等、patterns直接一致以外のケースは対象外
  const allExcluded = occurrences.every(o => isOccurrenceInExcludedContext(text, o.idx));
  if (allExcluded) {
    const uniquePatterns = [...new Set(occurrences.map(o => o.pattern))];
    return { confident: false, reason: `一致した語（${uniquePatterns.join('・')}）が禁止事項・質問文などの業務内容ではない文脈にのみ出現` };
  }
  return { confident: true, reason: null };
}

// ===== 修正6: SNS運用代行の除外を、制作／運用の文脈で再判定する =====
const SNS_CREATION_SIGNALS = ['投稿画像の制作', '投稿画像制作', 'デザイン制作', 'フィード投稿作成', '投稿デザイン', '単発制作', '単発の制作', 'バナー制作', '画像制作のみ', 'デザイン調整'];
const SNS_OPERATION_SIGNALS = ['投稿企画', '投稿代行', 'アカウント管理', 'アカウント運用', 'コメント対応', 'コメント返信', 'DM対応', '数値分析', '改善提案', '継続的な運用', '運用代行', '毎日投稿', '投稿スケジュール管理', '分析レポート'];

function reassessSnsExclusion(text) {
  const creationMatches = containsAny(text, SNS_CREATION_SIGNALS);
  const operationMatches = containsAny(text, SNS_OPERATION_SIGNALS);
  if (operationMatches.length > 0) {
    return { overridden: false, reason: `運用代行を示す記載（${operationMatches[0]}）が本文にあるため除外を維持`, creationMatches, operationMatches };
  }
  if (creationMatches.length > 0) {
    return { overridden: true, reason: `制作のみを示す記載（${creationMatches[0]}）があり、運用代行を示す記載が本文にないため除外を解除`, creationMatches, operationMatches };
  }
  return { overridden: false, reason: '制作範囲を明確に示す記載がなく、安全側として除外を維持', creationMatches, operationMatches };
}

// evaluateJob()はKnowledge判定の結果をjobオブジェクトへスプレッドして返すが、matchedCategoryオブジェクト
// 自体は返さない。evaluator.jsは変更できないため、同じ正規化済みテキストでclassifyCapability()を
// 独立して呼び、必要な情報を補う。加えて、品質監査で見つかった3つの誤判定パターンをここで補正する：
//   - SNS運用代行の除外を、制作/運用の文脈で再判定（修正6）
//   - 飲食テーマの汎用語単独一致を却下（修正4）
//   - 禁止事項・質問文の文脈にのみ出現する語でのカテゴリー一致を却下（修正5）
function evaluateWithCategory(detail) {
  const evalResult = evaluateJob(buildEvaluatorInput(detail));
  const text = stripNegatedPhrasesLocal(normalizeFullWidthDigits(`${detail.title} ${detail.description || ''}`));
  const capability = classifyCapability(text, yukiProfile);

  let excluded = evalResult.excluded;
  let excludeReason = evalResult.excludeReason;
  let rank = evalResult.rank || null;
  let displayTier = evalResult.displayTier || null;
  let capabilityStatus = evalResult.capabilityStatus;
  let evidenceType = evalResult.evidenceType;
  let capabilityReason = evalResult.capabilityReason;
  let matchedCapabilities = evalResult.matchedCapabilities;
  let missingEvidenceList = evalResult.missingEvidence;
  let decisionSource = evalResult.decisionSource;

  // 修正6：SNS運用代行として早期除外された案件を、制作/運用の文脈で再判定する
  let snsExclusionReassessment = null;
  if (excluded && excludeReason === 'SNS運用代行') {
    snsExclusionReassessment = reassessSnsExclusion(text);
    if (snsExclusionReassessment.overridden) {
      excluded = false;
      excludeReason = null;
      // evaluateJobは早期returnのためcapabilityStatus等を計算していない。
      // 同一テキストで計算済みのclassifyCapability結果を代わりに使う。
      capabilityStatus = capability.capabilityStatus;
      evidenceType = capability.evidenceType;
      capabilityReason = capability.capabilityReason;
      matchedCapabilities = capability.matchedCapabilities;
      missingEvidenceList = capability.missingEvidence;
      decisionSource = capability.decisionSource;
      rank = null; // 案件検索システムの通常スコアリングは未実行（除外解除はStage1独自の判断のため）
      displayTier = null;
    }
  }

  let matchedCategory = capability.matchedCategory;
  let domainExperience = capability.domainExperience;
  const categoryMatchNotes = [];
  let categoryMatchOverridden = false;

  function rejectCategoryMatch(reason) {
    categoryMatchNotes.push(reason);
    categoryMatchOverridden = true;
    const rejectedLabel = matchedCategory.label;
    matchedCategory = null;
    capabilityStatus = '確認候補';
    evidenceType = '証明不足';
    capabilityReason = `自動分類は「${rejectedLabel}」に一致したが、Stage1の精度チェックにより却下（${reason}）。人による確認が必要`;
    matchedCapabilities = [];
    missingEvidenceList = [`自動分類が却下されたため、対応する経験・実績を機械的に判定できない（${reason}）`];
    decisionSource = 'Stage1精度チェックにより自動判定を保留';
  }

  // 修正4：飲食テーマの根拠が「商品開発」等の汎用語のみの場合は却下
  if (matchedCategory && matchedCategory.id === 'hospitality_content' && !hasFoodContextConfirmation(text)) {
    rejectCategoryMatch('飲食テーマの根拠が「商品開発」等の汎用語のみで、飲食・店舗運営を示す語が本文に併記されていない');
  } else if (matchedCategory) {
    // 修正5：一致した語が禁止事項・質問文の文脈にのみ出現する場合は却下
    const recheck = reverifyCategoryMatch(text, matchedCategory);
    if (!recheck.confident) rejectCategoryMatch(recheck.reason);
  }
  if (domainExperience && !hasFoodContextConfirmation(text)) {
    categoryMatchNotes.push('飲食テーマ理解（ドメイン経験）は却下：飲食・店舗運営を示す語が本文に見つからない');
    domainExperience = null;
  }

  return {
    ...evalResult,
    excluded,
    excludeReason,
    rank,
    displayTier,
    capabilityStatus,
    evidenceType,
    capabilityReason,
    matchedCapabilities,
    missingEvidence: missingEvidenceList,
    decisionSource,
    matchedCategory,
    domainExperience,
    undecidedReason: capability.undecidedReason,
    categoryMatchNotes,
    categoryMatchOverridden,
    originalMatchedCategoryLabel: capability.matchedCategory ? capability.matchedCategory.label : null,
    snsExclusionReassessment,
  };
}

// ===== 修正2/3: 要求ツールの抽出とKnowledge使用可能ツールとの適合判定 =====
const KNOWN_TOOLS = ['Canva', 'PowerPoint', 'Illustrator', 'Photoshop', 'Notion', 'Figma', 'Excel', 'Googleスライド', 'ChatGPT', 'Claude Code', 'Claude', 'Dify', 'Word'];
const TOOL_NAME_ALIASES = { 'パワーポイント': 'PowerPoint', 'エクセル': 'Excel', 'ワード': 'Word', 'グーグルスライド': 'Googleスライド' };
const ALL_TOOL_SEARCH_TERMS = [...KNOWN_TOOLS, ...Object.keys(TOOL_NAME_ALIASES)];
const HARD_DISALLOWED_TOOLS = new Set(REQUIRED_TOOL_DISALLOWED.map(t => t.toLowerCase()));

function normalizeToolName(raw) {
  return TOOL_NAME_ALIASES[raw] || raw;
}

// 大文字小文字を区別せずツール名を検出する（'illustrator'と'Illustrator'を同一に扱う）。
function findToolMentions(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set();
  ALL_TOOL_SEARCH_TERMS.forEach(term => {
    if (lower.includes(term.toLowerCase())) found.add(normalizeToolName(term));
  });
  return [...found];
}

// 必須条件欄（確度高）→本文全体（確度中、依頼内容・作業詳細等の説明文からツール名を拾う）の順で
// 案件が要求するツールを特定する。
function extractRequiredTools(detail, conditions) {
  const requiredText = conditions.required.status === 'extracted' && conditions.required.value ? conditions.required.value : '';
  const bodyText = detail.description || '';
  const fromRequiredConditions = findToolMentions(requiredText);
  const fromBody = findToolMentions(bodyText);
  return { fromRequiredConditions, fromBody };
}

function assessToolFit(detail, conditions) {
  const { fromRequiredConditions, fromBody } = extractRequiredTools(detail, conditions);
  const requiredTools = fromRequiredConditions.length > 0 ? fromRequiredConditions : fromBody;
  const source = fromRequiredConditions.length > 0 ? 'required_conditions' : (fromBody.length > 0 ? 'job_body' : null);
  const availableToolsSet = new Set(yukiProfile.tools.available.map(t => t.toLowerCase()));

  const perTool = requiredTools.map(tool => {
    const lower = tool.toLowerCase();
    if (HARD_DISALLOWED_TOOLS.has(lower)) {
      return { tool, status: 'not_met', reason: `${tool}はKnowledge上の使用可能ツールに含まれておらず、使用不可ツールとして明記されている` };
    }
    if (availableToolsSet.has(lower)) {
      return { tool, status: 'met', reason: `${tool}はKnowledge上の使用可能ツール` };
    }
    return { tool, status: 'unknown', reason: `${tool}の使用経験はKnowledgeで確認できない` };
  });

  const hasHardBlock = perTool.some(t => t.status === 'not_met');
  const hasUnknown = perTool.some(t => t.status === 'unknown');

  return {
    requiredTools,
    source,
    perTool,
    hasHardBlock,
    hasUnknown,
    overallStatus: requiredTools.length === 0 ? 'no_tool_specified' : (hasHardBlock ? 'not_met' : (hasUnknown ? 'unknown' : 'met')),
  };
}

// 案件が要求するツールと、Knowledge判定カテゴリーの既定ツール（category.toolsUsed）が一致しない場合、
// そのカテゴリーの証拠区分を最大でも代替証明に格下げする（一部だけ一致する場合に案件全体を
// 直接証明と表示しない）。ツール自体がKnowledgeに存在しない場合はここでは判定しない（usableExperience
// 側でtool不一致として扱う）。
function computeEffectiveEvidenceType(searchSystemResult, toolFit) {
  const category = searchSystemResult.matchedCategory;
  if (!category || !category.toolsUsed || category.toolsUsed.length === 0) {
    return { evidenceType: searchSystemResult.evidenceType, toolMismatchNote: null };
  }
  const requiredTools = toolFit.requiredTools || [];
  if (requiredTools.length === 0) {
    return { evidenceType: searchSystemResult.evidenceType, toolMismatchNote: null };
  }
  const categoryTools = category.toolsUsed.map(t => t.toLowerCase());
  const matches = requiredTools.some(t => categoryTools.includes(t.toLowerCase()));
  if (matches) {
    return { evidenceType: searchSystemResult.evidenceType, toolMismatchNote: null };
  }
  const note = `案件が要求するツール（${requiredTools.join('・')}）とKnowledge判定カテゴリーの既定ツール（${category.toolsUsed.join('・')}）が一致しないため、ツールを直接証拠として提示しない`;
  const downgraded = searchSystemResult.evidenceType === '直接証明' ? '強い代替証明' : searchSystemResult.evidenceType;
  return { evidenceType: downgraded, toolMismatchNote: note };
}

// ===== 修正7: 同一営業資産のassetIdによる重複統合 =====
// Sales Knowledge上、同じ資産が異なる文言（deliverableEvidence / selfProducedEvidence 等）で
// 登録されている場合があるため、既知の対応表でassetIdへ正規化する。未登録の文言は自分自身をIDとする
// （＝重複しない安全側のフォールバック）。
const ASSET_ALIASES = {
  'AIライティング5記事（note系記事、SEO記事2本、比較記事、商品記事）': 'ai_writing_5_articles',
  'AIライティング5記事': 'ai_writing_5_articles',
  '自主制作「飲食事業改善 提案資料」（8ページ）': 'proposal_document_self_made',
  'AI画像5作品': 'ai_image_5_works',
  'AI画像ポートフォリオ5作品': 'ai_image_5_works',
};
function assetIdFor(text) {
  return ASSET_ALIASES[text] || text;
}

// ===== 1. 基本情報 =====
function buildJobSummary(detail) {
  return {
    jobId: detail.jobId,
    title: detail.title,
    url: detail.url,
    price: detail.price || { type: null, raw: null },
    deadline: detail.deadline || { raw: null, normalized: null, status: 'unknown' },
    currentTier: detail.detailFetchBucket || null,
    sourceDetailFetchedAt: detail.fetch ? detail.fetch.fetchedAt : null,
    analyzedAt: nowIso(),
    analysisVersion: ANALYSIS_VERSION,
  };
}

// ===== 2. クライアント情報 =====
function buildClientInfo(detail) {
  const c = detail.clientSummary || {};
  const stats = detail.applicationStats || {};
  return {
    name: c.name ?? null,
    isIdentityVerified: c.isIdentityVerified ?? null,
    isEmployerRuleCheckSucceeded: c.isEmployerRuleCheckSucceeded ?? null,
    reviewCount: null,
    reviewCountNote: 'CrowdWorksは評価件数を独立した数値として公開していないため取得不可（averageScore/thanksCountで代替可能性あり、要確認）',
    averageScore: c.averageScore ?? null,
    thanksCount: c.thanksCount ?? null,
    jobOfferAchievementCount: c.jobOfferAchievementCount ?? null,
    applied: stats.applied ?? null,
    contracted: stats.contracted ?? null,
    recruiting: stats.recruiting ?? null,
  };
}

// ===== 3. 依頼内容 =====
function buildRequestSummary(detail, searchSystemResult, conditions) {
  const text = `${detail.title} ${detail.description || ''}`;
  const continuityMatches = containsAny(text, CONTINUITY_PATTERNS);

  return {
    requestedWork: {
      value: searchSystemResult.matchedCategory ? searchSystemResult.matchedCategory.label : null,
      status: searchSystemResult.matchedCategory ? 'extracted' : 'requires_analysis',
      evidenceText: searchSystemResult.matchedCategory ? searchSystemResult.capabilityReason : null,
      source: 'search_system_reevaluation',
    },
    deliverable: { value: null, status: 'requires_analysis', evidenceText: null, source: 'job_detail' },
    scope: { value: null, status: 'requires_analysis', evidenceText: null, source: 'job_detail' },
    deliveryFormat: { value: null, status: 'requires_analysis', evidenceText: null, source: 'job_detail' },
    deadlineForWork: {
      value: detail.deadline ? detail.deadline.normalized : null,
      status: detail.deadline && detail.deadline.normalized ? 'extracted' : 'unavailable',
      evidenceText: detail.deadline ? detail.deadline.raw : null,
      source: 'job_detail',
    },
    continuity: {
      value: continuityMatches.length > 0,
      status: continuityMatches.length > 0 ? 'extracted' : 'not_found',
      evidenceText: continuityMatches.length > 0 ? continuityMatches[0] : null,
      source: 'rule(CONTINUITY_PATTERNS)',
    },
    requiredTool: conditions.requiredTool,
    workload: { value: null, status: 'requires_analysis', evidenceText: null, source: 'job_detail' },
    priceCondition: {
      value: detail.price ? detail.price.raw : null,
      status: detail.price && detail.price.raw ? 'extracted' : 'unavailable',
      evidenceText: detail.price ? detail.price.type : null,
      source: 'job_detail',
    },
  };
}

// ===== 4. クライアントの目的 =====
function buildClientPurpose(detail, searchSystemResult) {
  const categoryId = searchSystemResult.matchedCategory ? searchSystemResult.matchedCategory.id : null;
  const dict = categoryId ? yukiJobDictionary.jobDictionary[categoryId] : null;

  if (!dict) {
    return {
      surfacePurpose: { value: null, status: 'requires_ai_analysis', evidence: [] },
      deeperGoal: { value: null, status: 'requires_ai_analysis', evidence: [] },
      hiringConcerns: { value: null, status: 'requires_ai_analysis', evidence: [] },
    };
  }
  return {
    surfacePurpose: {
      value: dict.clientPurpose,
      status: 'extracted',
      evidence: [`${dict.section}（案件辞典）`, `Knowledge判定カテゴリー: ${searchSystemResult.matchedCategory.label}`],
    },
    deeperGoal: { value: null, status: 'requires_ai_analysis', evidence: [] },
    hiringConcerns: {
      value: dict.hiringConcerns,
      status: 'extracted',
      evidence: [`${dict.section}（案件辞典・採用時の不安）`],
    },
  };
}

// ===== 5. 応募条件 =====
function conditionEntry(value, status, evidenceText, source) {
  return { value, status, evidenceText, source };
}

// 修正9：見出しが完全一致しなくても、応募時の回答項目を求める可能性のある記載を緩やかに検知する。
// 存在しないと断定せず、requires_ai_analysisとして前後の本文とともに保持する。
const SOFT_RESPONSE_ITEM_SIGNALS = [
  '応募時に以下', '応募・選考について', '応募用テンプレート', '以下の質問へご回答', '応募の際は', 'ご回答ください', 'ご質問の回答', '以下ご質問', '応募方法',
];
function detectSoftResponseItemsSignal(description) {
  if (!description) return null;
  for (const signal of SOFT_RESPONSE_ITEM_SIGNALS) {
    const idx = description.indexOf(signal);
    if (idx !== -1) {
      const start = Math.max(0, idx - 20);
      const end = Math.min(description.length, idx + 400);
      return { signal, excerpt: description.slice(start, end).trim() };
    }
  }
  return null;
}

function buildConditions(detail) {
  const text = `${detail.title} ${detail.description || ''}`;
  const req = detail.requiredConditions || { value: null, status: 'unavailable', matchedHeading: null };
  const wel = detail.welcomeConditions || { value: null, status: 'unavailable', matchedHeading: null };
  const resp = detail.responseItems || { value: null, status: 'unavailable', matchedHeading: null };

  const attributeExcludeMatches = containsAny(text, APPLICANT_ATTRIBUTE_EXCLUDE_PATTERNS);
  const attributeCautionMatches = containsAny(text, APPLICANT_ATTRIBUTE_CAUTION_PATTERNS);
  const experienceMatches = containsAny(text, EXPERIENCE_PREFERRED_PATTERNS);
  const beginnerMatches = containsAny(text, BEGINNER_PATTERNS);

  const workHoursMatch = text.match(/週\s*\d+\s*時間|1日\s*\d+\s*時間|曜日\s*(固定|指定|相談)/);
  const portfolioMatch = text.match(/ポートフォリオ(提出|必須|添付|ご提示)?|実績(提出|添付)|サンプル(提出|添付)/);
  const testInterviewMatch = text.match(/テストライティング|トライアル|面談|オンライン面談|Zoom面談|テスト応募|簡単なテスト/);

  let responseItemsEntry;
  if (resp.status === 'extracted') {
    responseItemsEntry = conditionEntry(resp.value, 'extracted', resp.matchedHeading, 'job_detail');
  } else {
    const soft = detectSoftResponseItemsSignal(detail.description);
    responseItemsEntry = soft
      ? { value: null, status: 'requires_ai_analysis', evidenceText: soft.excerpt, source: 'rule(soft_signal)', possibleSignal: soft.signal }
      : conditionEntry(resp.value, resp.status || 'unavailable', resp.matchedHeading, 'job_detail');
  }

  return {
    required: conditionEntry(req.value, req.status || 'unavailable', req.matchedHeading, 'job_detail'),
    welcome: conditionEntry(wel.value, wel.status || 'unavailable', wel.matchedHeading, 'job_detail'),
    responseItems: responseItemsEntry,
    attribute: attributeExcludeMatches.length > 0
      ? conditionEntry(attributeExcludeMatches[0], 'extracted', '応募者の属性条件を明示的に求める表現', 'rule(APPLICANT_ATTRIBUTE_EXCLUDE_PATTERNS)')
      : (attributeCautionMatches.length > 0
        ? conditionEntry(attributeCautionMatches[0], 'requires_analysis', 'ターゲット説明か属性条件か本文だけでは断定不可', 'rule(APPLICANT_ATTRIBUTE_CAUTION_PATTERNS)')
        : conditionEntry(null, 'not_found', null, 'rule')),
    workHours: workHoursMatch
      ? conditionEntry(workHoursMatch[0], 'extracted', workHoursMatch[0], 'rule(regex)')
      : conditionEntry(null, 'requires_analysis', null, 'job_detail'),
    requiredTool: conditionEntry(null, 'requires_analysis', null, 'job_detail'), // assessToolFit側で再設定
    requiredExperience: experienceMatches.length > 0
      ? conditionEntry(experienceMatches[0], 'extracted', beginnerMatches.length > 0 ? '未経験可の記載も併記あり' : null, 'rule(EXPERIENCE_PREFERRED_PATTERNS)')
      : conditionEntry(null, 'not_found', null, 'rule'),
    portfolioRequired: portfolioMatch
      ? conditionEntry(portfolioMatch[0], 'extracted', portfolioMatch[0], 'rule(regex)')
      : conditionEntry(null, 'requires_analysis', null, 'job_detail'),
    testOrInterview: testInterviewMatch
      ? conditionEntry(testInterviewMatch[0], 'extracted', testInterviewMatch[0], 'rule(regex)')
      : conditionEntry(null, 'requires_analysis', null, 'job_detail'),
  };
}

// 必須ツール条件は、修正2で実装したツール適合判定（assessToolFit）の結果を使って確定させる。
function finalizeRequiredToolCondition(toolFit) {
  if (toolFit.requiredTools.length === 0) {
    return conditionEntry(null, 'requires_analysis', null, 'job_detail');
  }
  if (toolFit.hasHardBlock) {
    const blocked = toolFit.perTool.filter(t => t.status === 'not_met').map(t => t.tool);
    return conditionEntry(toolFit.requiredTools.join('・'), 'extracted', `使用不可ツール(${blocked.join('・')})が要求されている`, 'rule(tool_fit)');
  }
  if (toolFit.hasUnknown) {
    const unknown = toolFit.perTool.filter(t => t.status === 'unknown').map(t => t.tool);
    return conditionEntry(toolFit.requiredTools.join('・'), 'requires_confirmation', `Knowledgeに使用実績の記載がないツール(${unknown.join('・')})が要求されている`, 'rule(tool_fit)');
  }
  return conditionEntry(toolFit.requiredTools.join('・'), 'extracted', 'Knowledge上の使用可能ツールと一致', 'rule(tool_fit)');
}

// ===== 6. 条件適合 =====
function assessFit({ status, capabilityStatus, evidenceType, hardBlock }) {
  if (hardBlock) return { status: 'not_met', reason: hardBlock };
  if (status !== 'extracted') return { status: 'unknown', reason: '条件文が本文から明確に抽出できていないため判定不能' };
  if (capabilityStatus === '対応不可') return { status: 'not_met', reason: 'Knowledge判定（全文再評価）が対応不可のため' };
  if (evidenceType === '直接証明' || evidenceType === '強い代替証明') return { status: 'met', reason: `Knowledge上の証拠区分が${evidenceType}のため` };
  if (evidenceType === '弱い代替証明') return { status: 'partially_met', reason: 'Knowledge上の証拠区分が弱い代替証明のため' };
  return { status: 'unknown', reason: 'Knowledge上で判断材料が不足' };
}

function buildFitAssessment(conditions, searchSystemResult, toolFit) {
  const cs = searchSystemResult.capabilityStatus;
  const ev = searchSystemResult.evidenceType;
  const items = [];

  items.push({
    condition: '必須条件（本文抽出）',
    value: conditions.required.value,
    ...assessFit({ status: conditions.required.status, capabilityStatus: cs, evidenceType: ev }),
  });
  items.push({
    condition: '歓迎条件（本文抽出）',
    value: conditions.welcome.value,
    ...(conditions.welcome.status === 'extracted'
      ? { status: (ev === '直接証明' || ev === '強い代替証明') ? 'met' : (ev === '弱い代替証明' ? 'partially_met' : 'unknown'), reason: '歓迎条件は必須ではないため参考評価' }
      : { status: 'unknown', reason: '本文から抽出できていないため判定不能' }),
  });
  items.push({
    condition: '属性条件（年齢・性別・居住地等）',
    value: conditions.attribute.value,
    ...assessFit({
      status: conditions.attribute.status === 'extracted' ? 'extracted' : 'requires_analysis',
      capabilityStatus: cs,
      evidenceType: ev,
      hardBlock: conditions.attribute.status === 'extracted' ? '応募者属性を明示的に求める表現があり、Knowledge上で満たせるか確認できない' : null,
    }),
  });
  // 必須ツールは修正2のツール適合判定を直接使う（従来のassessFit経由より精度が高い）
  items.push({
    condition: '必須ツール',
    value: conditions.requiredTool.value,
    status: toolFit.overallStatus === 'no_tool_specified' ? 'unknown' : toolFit.overallStatus,
    reason: toolFit.perTool.length > 0
      ? toolFit.perTool.map(t => `${t.tool}: ${t.reason}`).join('; ')
      : '案件本文から要求ツールを特定できなかった',
  });
  items.push({
    condition: '必須経験（経験者歓迎等の記載）',
    value: conditions.requiredExperience.value,
    ...assessFit({ status: conditions.requiredExperience.status, capabilityStatus: cs, evidenceType: ev }),
  });

  return items;
}

// ===== 7・8. 使用可能な経験・能力／証拠 =====
// stop案件（recommendation.value === 'stop'）ではこの関数自体を呼ばず、呼び出し側で空配列を使う
// （修正1：応募材料の完全抑制）。
function buildUsableExperienceAndEvidence(searchSystemResult, toolFit) {
  const usableExperience = [];
  const evidence = { direct: [], alternative: [], insufficient: [] };
  const category = searchSystemResult.matchedCategory;
  const evidenceType = searchSystemResult.evidenceType;
  const domainExperience = searchSystemResult.domainExperience;

  if (!category) {
    return { usableExperience, evidence };
  }

  const dict = yukiJobDictionary.jobDictionary[category.id];
  const valueDict = yukiJobDictionary.valueConversion[category.id];
  const clientValueText = valueDict ? valueDict.entries[0].value : (dict ? dict.clientPurpose : null);

  function addEntry(name, knowledgeText, evidenceKind) {
    if (!knowledgeText) return;
    const id = `${category.id}:${evidenceKind}`;
    usableExperience.push({
      id,
      assetId: assetIdFor(knowledgeText),
      name,
      knowledgeText,
      connectionReason: `Knowledge判定カテゴリー「${category.label}」の証拠として登録済み（${category.decisionSource}）`,
      evidenceKind, // deliverable / paid / self_produced / tool / domain
      evidenceLevel: '使用可能', // Sales Knowledge 5-1「使用可能」区分の項目のみをここで扱っている
      clientValue: clientValueText,
      usableInProposal: true,
    });
  }

  addEntry('受注・実務経験', category.paidExperience, 'paid');
  addEntry('制作実績', category.deliverableEvidence, 'deliverable');
  addEntry('自主制作物', category.selfProducedEvidence, 'self_produced');

  // 修正2/3：案件が要求するツールとカテゴリー既定ツールが一致する場合のみ「使用可能ツール」を提示する。
  // 一致しない場合（例：Canva案件にproposal_documentのPowerPointが既定されている）は、ツールの直接証拠
  // としては提示しない（構成力・情報整理力等の能力証拠は他のaddEntryで別途提示済み）。
  const requiredTools = toolFit.requiredTools || [];
  const categoryTools = (category.toolsUsed || []).map(t => t.toLowerCase());
  const toolMatches = requiredTools.length === 0 || requiredTools.some(t => categoryTools.includes(t.toLowerCase()));
  if (category.toolsUsed && category.toolsUsed.length > 0 && toolMatches) {
    addEntry('使用可能ツール', category.toolsUsed.join('・'), 'tool');
  }

  if (domainExperience) {
    addEntry('テーマ理解（業界経験）', domainExperience, 'domain');
  }

  evidence[evidenceBucketFor(evidenceType)] = usableExperience.map(e => ({ id: e.id, assetId: e.assetId, name: e.name, text: e.knowledgeText }));

  return { usableExperience, evidence };
}

function evidenceBucketFor(evidenceType) {
  if (evidenceType === '直接証明') return 'direct';
  if (evidenceType === '証明不足') return 'insufficient';
  return 'alternative'; // 強い代替証明・弱い代替証明
}

// ===== 9. 提供できる価値 =====
// 修正7：完全一致ではなくassetIdで重複排除する（同じ資産が別表記で複数回登場するのを防ぐ）。
function buildClientValueChain(searchSystemResult, usableExperience) {
  const category = searchSystemResult.matchedCategory;
  if (!category || usableExperience.length === 0) {
    return [{ experience: null, capability: null, rationale: null, evidence: null, clientValue: null, status: 'requires_ai_analysis' }];
  }
  const valueDict = yukiJobDictionary.valueConversion[category.id];
  const seen = new Set();
  return usableExperience
    .filter(e => {
      if (seen.has(e.assetId)) return false;
      seen.add(e.assetId);
      return true;
    })
    .map(e => ({
      assetId: e.assetId,
      experience: e.knowledgeText,
      capability: category.requiredCapabilities.join('・'),
      rationale: searchSystemResult.capabilityReason,
      evidence: searchSystemResult.evidenceType,
      clientValue: e.clientValue,
      status: valueDict ? 'extracted' : 'requires_ai_analysis',
      expressionExample: valueDict ? valueDict.entries[0].expression : null,
    }));
}

// ===== 10. 不足情報 =====
// Knowledgeで既に答えが分かっている項目は再度質問しない。修正2：Knowledgeに使用実績のないツール
// （Notion等）は不足情報として明示する。
function buildMissingInformation(conditions, searchSystemResult, toolFit) {
  const missing = [];

  if (conditions.responseItems.status === 'extracted' && conditions.responseItems.value) {
    missing.push({ item: 'クライアント指定の質問への回答内容', detail: conditions.responseItems.value, reason: '案件が個別の回答項目を指定しているため' });
    if (/自己紹介|志望動機|興味|関心|なぜ/.test(conditions.responseItems.value)) {
      missing.push({ item: '応募理由に必要な個人的関心・志望動機', detail: null, reason: 'Knowledgeには個人の関心・志望動機は記載されていないため' });
    }
    if (/稼働.*時間|開始.*可能|作業.*可能.*時間/.test(conditions.responseItems.value)) {
      missing.push({ item: '1日の対応可能時間・開始可能日', detail: null, reason: 'Common Knowledgeには具体的な稼働時間の記載がないため' });
    }
  }
  if (conditions.responseItems.status === 'requires_ai_analysis') {
    missing.push({ item: '応募時に回答が必要な項目の確認（意味解析待ち）', detail: conditions.responseItems.evidenceText, reason: '見出しは一致しないが、応募時の回答を求める可能性のある記載が本文にあるため' });
  }
  if (conditions.workHours.status === 'extracted') {
    missing.push({ item: '希望稼働時間・曜日への対応可否', detail: conditions.workHours.value, reason: 'Common Knowledgeには1日あたりの具体的な対応可能時間の記載がないため' });
  }
  if (conditions.portfolioRequired.status === 'extracted') {
    missing.push({ item: 'ポートフォリオの最新URL・提示可否', detail: conditions.portfolioRequired.value, reason: 'Sales Knowledgeに「最新URLを使用」と記載があるが、URL自体はKnowledgeに含まれていないため' });
  }
  if (conditions.required.status === 'requires_analysis') {
    missing.push({ item: '必須条件の内容確認', detail: null, reason: '本文から見出しで抽出できず、意味解析待ちのため' });
  }
  if (toolFit.hasUnknown) {
    toolFit.perTool.filter(t => t.status === 'unknown').forEach(t => {
      missing.push({ item: `${t.tool}使用経験の確認`, detail: null, reason: 'Knowledgeに使用実績の記載がないツールが案件で求められているため' });
    });
  }
  if (searchSystemResult.confirmBeforeApply && searchSystemResult.confirmBeforeApply.length > 0) {
    searchSystemResult.confirmBeforeApply.forEach(c => missing.push({ item: c, detail: null, reason: '案件検索システムの判定結果で応募前確認事項とされているため' }));
  }

  // 重複除去（item文字列が完全一致するもの）
  const seen = new Set();
  return missing.filter(m => {
    if (seen.has(m.item)) return false;
    seen.add(m.item);
    return true;
  });
}

// ===== 11. ポートフォリオ候補 =====
// URLはKnowledge・設定のどちらにも存在しないため作成しない（null固定）。
// 修正7：assetIdで重複統合する（完全一致だけでなく「同じ資産の異なる表記」も1件にまとめる）。
function buildPortfolioCandidates(searchSystemResult, usableExperience) {
  const category = searchSystemResult.matchedCategory;
  if (!category) return [];

  const byAsset = new Map();
  usableExperience.forEach(e => {
    if (e.evidenceKind !== 'deliverable' && e.evidenceKind !== 'self_produced') return;
    const candidate = {
      assetId: e.assetId,
      assetName: e.knowledgeText,
      url: null,
      urlNote: 'Knowledge・設定にURLの記載がないため未設定。使用前に永峯勇気へURL確認が必要',
      connectionReason: e.connectionReason,
      recommendationLevel: searchSystemResult.evidenceType === '直接証明' ? '高' : (searchSystemResult.evidenceType === '強い代替証明' ? '中' : '低'),
      caution: e.evidenceKind === 'self_produced'
        ? '自主制作物であり、外部クライアントからの受注実績ではないと明記すること'
        : '公開可否・最新版かどうかを確認してから使用すること',
    };
    const existing = byAsset.get(e.assetId);
    // self_produced由来の注意書き（誤って受注実績と見せない）を優先して残す
    if (!existing || e.evidenceKind === 'self_produced') byAsset.set(e.assetId, candidate);
  });
  return [...byAsset.values()];
}

// ===== 12. 安全性・注意点 =====
function buildSafetyReview(detail, searchSystemResult) {
  const text = `${detail.title} ${detail.description || ''}`;
  const review = {};

  review.externalContactSolicitation = scanSafety(text, [/LINE\s*(で|に|へ)?\s*連絡/, /Skype/, /直接.{0,5}連絡先/, /外部.{0,5}(サイト|アプリ)へ誘導/]);
  review.unpaidWorkBeforeContract = scanSafety(text, [/無償.{0,5}(トライアル|作業|対応)/, /契約前.{0,10}(サンプル|作業|制作)/]);
  review.expensivePurchase = scanSafety(text, [/教材.{0,5}購入/, /セミナー.{0,5}参加費/, /自己投資/, /高額.{0,5}(商品|プラン)/]);
  review.infoProductOrSchool = scanSafety(text, [/情報商材/, /スクール.{0,5}(紹介|勧誘|入会)/, /副業.{0,5}紹介/]);
  review.unclearCompensation = detail.price && detail.price.raw ? { status: 'no_signal_detected', evidence: [] } : { status: 'requires_review', evidence: ['報酬情報が本文・概要欄から取得できていない'] };
  review.personalInfoRequest = scanSafety(text, [/口座番号/, /マイナンバー/, /身分証.{0,5}(提出|送付|コピー)/]);
  review.categoryMismatch = searchSystemResult.excludeReason && /不一致/.test(searchSystemResult.excludeReason)
    ? { status: 'flagged_by_search_system', evidence: [searchSystemResult.excludeReason] }
    : { status: 'no_signal_detected', evidence: [] };
  review.notUsableAsAchievement = (!searchSystemResult.matchedCategory || searchSystemResult.evidenceType === '証明不足')
    ? { status: 'requires_review', evidence: ['Sales Knowledge上、この案件を実績として転用できる根拠が薄い可能性がある'] }
    : { status: 'no_signal_detected', evidence: [] };
  review.futureVisionAlignment = {
    aligned: searchSystemResult.highValueSignals && searchSystemResult.highValueSignals.some(s => s.type === 'asset'),
    evidence: (searchSystemResult.highValueSignals || []).filter(s => s.type === 'asset').map(s => s.text),
  };
  if (searchSystemResult.excludeReason === 'リスクあり') {
    review.riskPatternDetected = { status: 'flagged_by_search_system', evidence: ['案件検索システムのリスクパターンに一致'] };
  }
  if (searchSystemResult.categoryMatchOverridden) {
    review.categoryMatchLowConfidence = { status: 'requires_review', evidence: searchSystemResult.categoryMatchNotes };
  }

  return review;
}

function scanSafety(text, regexList) {
  const matched = regexList.filter(r => r.test(text));
  if (matched.length === 0) return { status: 'no_signal_detected', evidence: [] };
  return { status: 'requires_review', evidence: matched.map(r => r.source) };
}

// ===== 13. 応募推奨度 =====
// 案件検索システムの区分（displayTier等）は変更しない。ここではStage1独自の補足評価を行う。
// 修正2：必須ツールが使用不可（例：Illustrator）の場合は最優先でstopにする。
function buildRecommendation({ searchSystemResult, safetyReview, missingInformation, conditions, toolFit }) {
  const reasons = [];

  if (toolFit.hasHardBlock) {
    const blocked = toolFit.perTool.filter(t => t.status === 'not_met').map(t => t.tool);
    reasons.push(`必須ツール（${blocked.join('・')}）がKnowledge上の使用可能ツールにないため`);
    return { value: 'stop', reasons };
  }

  const hardStop = searchSystemResult.excluded === true
    || searchSystemResult.capabilityStatus === '対応不可'
    || (safetyReview.riskPatternDetected && safetyReview.riskPatternDetected.status === 'flagged_by_search_system');
  if (hardStop) {
    reasons.push(searchSystemResult.excludeReason
      ? `案件詳細の全文再評価で「${searchSystemResult.excludeReason}」に該当した`
      : 'Knowledge判定（全文再評価）が対応不可のため');
    return { value: 'stop', reasons };
  }

  const conditionHardBlock = conditions.attribute.status === 'extracted';
  if (conditionHardBlock) {
    reasons.push('必須条件（応募者属性）がKnowledge上の対応可能範囲と一致しない可能性がある');
    return { value: 'stop', reasons };
  }

  const evidenceType = searchSystemResult.evidenceType;
  const capabilityStatus = searchSystemResult.capabilityStatus;

  if (capabilityStatus === '確認候補') {
    reasons.push('Knowledgeだけでは対応可能・対応不可のどちらとも断定できない案件のため（確認候補）');
    return { value: 'hold', reasons };
  }

  // ツールがKnowledgeで未確認（Notion等）の場合は、証拠が強くても proceed（無条件可）にはしない
  const cappedByUnknownTool = toolFit.hasUnknown;

  if ((capabilityStatus === '応募可能' || capabilityStatus === 'チャレンジ可能') && (evidenceType === '直接証明' || evidenceType === '強い代替証明')) {
    if (missingInformation.length > 0 || cappedByUnknownTool) {
      const extra = cappedByUnknownTool ? '、使用経験未確認のツールがある' : '';
      reasons.push(`証拠は十分（${evidenceType}）だが、応募文作成前に確認すべき情報が${missingInformation.length}件ある${extra}`);
      return { value: 'proceed_after_confirmation', reasons };
    }
    reasons.push(`Knowledge判定が${capabilityStatus}・証拠区分が${evidenceType}で、追加確認事項もないため`);
    return { value: 'proceed', reasons };
  }

  if ((capabilityStatus === '応募可能' || capabilityStatus === 'チャレンジ可能') && evidenceType === '弱い代替証明') {
    reasons.push('証拠区分が弱い代替証明のため、応募文作成前の確認を推奨');
    return { value: 'proceed_after_confirmation', reasons };
  }

  reasons.push('証拠が証明不足、または誇張なしに条件を満たせるか判断できないため');
  return { value: 'stop', reasons };
}

// ===== 14. 応募文生成材料 =====
function buildProposalMaterials({ searchSystemResult, usableExperience, evidence, portfolioCandidates, conditions }) {
  const category = searchSystemResult.matchedCategory;
  const dict = category ? yukiJobDictionary.jobDictionary[category.id] : null;

  const requiredAnswers = [];
  if (conditions.responseItems.status === 'extracted') requiredAnswers.push(conditions.responseItems.value);
  if (conditions.required.status === 'extracted') requiredAnswers.push(conditions.required.value);

  const avoidExpressions = [
    ...yukiJobDictionary.generalProhibited.expressions,
    ...(dict ? dict.avoidExpressions : []),
  ];

  const prohibitedClaims = [
    ...yukiJobDictionary.generalProhibited.numbers.map(n => `数値「${n}」は要確認情報のため使用しない`),
    ...yukiJobDictionary.generalProhibited.notClientWork.map(w => `「${w}」は自主制作物であり、外部クライアントの受注実績として書かない`),
    ...(searchSystemResult.missingEvidence || []),
  ];

  return {
    centralMessage: dict ? dict.properFraming : null,
    usableExperienceIds: usableExperience.map(e => e.id),
    usableEvidenceIds: [...new Set([...evidence.direct, ...evidence.alternative].map(e => e.assetId || e.id))],
    portfolioIds: portfolioCandidates.map(p => p.assetId || p.assetName),
    requiredAnswers,
    avoidExpressions,
    prohibitedClaims,
    personalizationPoints: { value: null, status: 'requires_ai_analysis' },
  };
}

// stop案件用：応募材料を一切含まない空の構造（修正1）。
function emptyProposalMaterials() {
  return {
    centralMessage: null,
    usableExperienceIds: [],
    usableEvidenceIds: [],
    portfolioIds: [],
    requiredAnswers: [],
    avoidExpressions: [],
    prohibitedClaims: [],
    personalizationPoints: { value: null, status: 'not_applicable' },
  };
}

// ===== AI引き継ぎデータ =====
function buildAiHandoff({ detail, searchSystemResult, conditions, clientPurpose, clientValueChain, safetyReview, toolFit, proposalGenerationAllowed }) {
  const tasks = [];
  if (!proposalGenerationAllowed) {
    tasks.push('この案件は応募材料の生成対象外です（stop）。AI意味解析は不要です。');
  } else {
    if (clientPurpose.deeperGoal.status === 'requires_ai_analysis') tasks.push('clientPurpose.deeperGoal（成果物を使って達成したいこと）');
    if (!searchSystemResult.matchedCategory) tasks.push('requestSummary（依頼業務のジャンルが未確定のため、案件本文から業務内容を判定）');
    if (clientValueChain.some(c => c.status === 'requires_ai_analysis')) tasks.push('clientValue（提供価値の最適な接続表現）');
    tasks.push('proposalMaterials.personalizationPoints（定型文に見えない個別化ポイント）');
    if (conditions.responseItems.status === 'requires_ai_analysis') {
      tasks.push(`conditions.responseItems（応募時の質問候補を本文から特定・整理：${conditions.responseItems.possibleSignal || ''}）`);
    }
    if (toolFit.hasUnknown) {
      tasks.push(`toolFit（Knowledgeに使用実績のないツール${toolFit.perTool.filter(t => t.status === 'unknown').map(t => t.tool).join('・')}の使用可否を永峯勇気に確認）`);
    }
  }
  Object.entries(safetyReview).forEach(([key, v]) => {
    if (v && v.status === 'requires_review') tasks.push(`safetyReview.${key}（曖昧な安全性判断の確認）`);
  });

  return {
    required: tasks.length > 0,
    tasks,
    input: {
      jobDescriptionFull: detail.description,
      clientInfo: detail.clientSummary,
      extractedConditions: {
        required: conditions.required.value,
        welcome: conditions.welcome.value,
        responseItems: conditions.responseItems.value,
        responseItemsCandidateExcerpt: conditions.responseItems.status === 'requires_ai_analysis' ? conditions.responseItems.evidenceText : null,
      },
      toolFit: {
        requiredTools: toolFit.requiredTools,
        overallStatus: toolFit.overallStatus,
        perTool: toolFit.perTool,
      },
      searchSystemJudgment: {
        capabilityStatus: searchSystemResult.capabilityStatus,
        evidenceType: searchSystemResult.evidenceType,
        matchedCapabilities: searchSystemResult.matchedCapabilities,
        capabilityReason: searchSystemResult.capabilityReason,
        decisionSource: searchSystemResult.decisionSource,
        rank: searchSystemResult.rank,
        displayTier: searchSystemResult.displayTier,
        categoryMatchOverridden: searchSystemResult.categoryMatchOverridden,
        categoryMatchNotes: searchSystemResult.categoryMatchNotes,
        snsExclusionReassessment: searchSystemResult.snsExclusionReassessment,
      },
      salesKnowledgeRelevant: searchSystemResult.matchedCategory ? {
        categoryId: searchSystemResult.matchedCategory.id,
        categoryLabel: searchSystemResult.matchedCategory.label,
        decisionSource: searchSystemResult.matchedCategory.decisionSource,
        section: `knowledge/yuki_sales_knowledge_v1.md 案件辞典 ${yukiJobDictionary.jobDictionary[searchSystemResult.matchedCategory.id]?.section || ''}`,
      } : null,
      commonKnowledgeRelevant: {
        name: yukiCommonProfile.basicProfile.name,
        workConstraints: yukiCommonProfile.workConstraints.summary,
        availableTools: yukiCommonProfile.availableTools,
        tone: yukiCommonProfile.values.tone,
      },
      mustNotUse: {
        prohibitedNumbers: yukiJobDictionary.generalProhibited.numbers,
        notClientWork: yukiJobDictionary.generalProhibited.notClientWork,
        prohibitedExpressions: yukiJobDictionary.generalProhibited.expressions,
        undisclosedPersonalFields: yukiCommonProfile.undisclosedFields,
      },
      outputSchemaRef: 'yuki_sales_knowledge_v1.md 第11章「GPTsでの出力ルール」11-1 必須出力要素（1.クライアントが実現したいこと〜7.事実の強さに合った表現）',
    },
  };
}

// ===== Sales Knowledge / Common Knowledge の矛盾チェック =====
function checkKnowledgeConsistency() {
  const salesTools = new Set(yukiProfile.tools.available);
  const commonTools = new Set(yukiCommonProfile.availableTools);
  const conflicts = [];

  const commonOnlyTools = [...commonTools].filter(t => !salesTools.has(t));
  if (commonOnlyTools.length > 0) {
    conflicts.push({
      field: 'availableTools',
      status: 'requires_confirmation',
      detail: `Common Knowledgeにのみ記載があり、Sales Knowledgeの使用可能ツールに含まれないツール: ${commonOnlyTools.join('・')}`,
    });
  }

  return { hasConflict: conflicts.length > 0, conflicts };
}

// ===== メイン: 1案件分の分析データを生成 =====
function analyzeJobDetail(detail) {
  // 修正8：正規Knowledge（Markdown）とJSキャッシュが同期していない場合はここで停止する。
  assertKnowledgeInSync();

  const searchSystemResult = evaluateWithCategory(detail);

  const conditions = buildConditions(detail);
  const toolFit = assessToolFit(detail, conditions);
  conditions.requiredTool = finalizeRequiredToolCondition(toolFit);

  // 修正3：ツール不一致による証拠区分の格下げをここで確定し、以降すべての判定に反映する。
  const { evidenceType: effectiveEvidenceType, toolMismatchNote } = computeEffectiveEvidenceType(searchSystemResult, toolFit);
  searchSystemResult.evidenceType = effectiveEvidenceType;

  const jobSummary = buildJobSummary(detail);
  const clientInfo = buildClientInfo(detail);
  const requestSummary = buildRequestSummary(detail, searchSystemResult, conditions);
  const clientPurpose = buildClientPurpose(detail, searchSystemResult);
  const fitAssessment = buildFitAssessment(conditions, searchSystemResult, toolFit);
  const missingInformation = buildMissingInformation(conditions, searchSystemResult, toolFit);
  const safetyReview = buildSafetyReview(detail, searchSystemResult);
  const recommendation = buildRecommendation({ searchSystemResult, safetyReview, missingInformation, conditions, toolFit });

  // 修正1：stop案件は応募材料を一切生成しない（後続処理が誤って応募文を作れない構造にする）。
  const proposalGenerationAllowed = recommendation.value !== 'stop';
  let usableExperience = [];
  let evidence = { direct: [], alternative: [], insufficient: [] };
  let clientValueChain = [];
  let portfolioCandidates = [];
  let proposalMaterials = emptyProposalMaterials();

  if (proposalGenerationAllowed) {
    const built = buildUsableExperienceAndEvidence(searchSystemResult, toolFit);
    usableExperience = built.usableExperience;
    evidence = built.evidence;
    clientValueChain = buildClientValueChain(searchSystemResult, usableExperience);
    portfolioCandidates = buildPortfolioCandidates(searchSystemResult, usableExperience);
    proposalMaterials = buildProposalMaterials({ searchSystemResult, usableExperience, evidence, portfolioCandidates, conditions });
  }

  const aiHandoff = buildAiHandoff({ detail, searchSystemResult, conditions, clientPurpose, clientValueChain, safetyReview, toolFit, proposalGenerationAllowed });

  return {
    jobId: detail.jobId,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: jobSummary.analyzedAt,
    sourceDetailFetchedAt: jobSummary.sourceDetailFetchedAt,
    sourceFiles: {
      jobDetail: `data/private/job_details/${detail.jobId}.json`,
      salesKnowledge: 'knowledge/yuki_sales_knowledge_v1.md',
      commonKnowledge: yukiCommonProfile.sourceVersion,
    },
    proposalGenerationAllowed,
    jobSummary,
    clientInfo,
    requestSummary,
    clientPurpose,
    conditions,
    fitAssessment,
    toolFit,
    toolMismatchNote,
    usableExperience,
    evidence,
    clientValue: clientValueChain,
    missingInformation,
    portfolioCandidates,
    safetyReview,
    recommendation,
    proposalMaterials,
    searchSystemReevaluation: {
      capabilityStatus: searchSystemResult.capabilityStatus,
      capabilityReason: searchSystemResult.capabilityReason,
      evidenceType: searchSystemResult.evidenceType,
      matchedCapabilities: searchSystemResult.matchedCapabilities,
      missingEvidence: searchSystemResult.missingEvidence,
      decisionSource: searchSystemResult.decisionSource,
      excluded: searchSystemResult.excluded,
      excludeReason: searchSystemResult.excludeReason,
      rank: searchSystemResult.rank || null,
      displayTier: searchSystemResult.displayTier || null,
      categoryMatchOverridden: searchSystemResult.categoryMatchOverridden,
      categoryMatchNotes: searchSystemResult.categoryMatchNotes,
      originalMatchedCategoryLabel: searchSystemResult.originalMatchedCategoryLabel,
      snsExclusionReassessment: searchSystemResult.snsExclusionReassessment,
    },
    aiHandoff,
    knowledgeConsistencyCheck: checkKnowledgeConsistency(),
  };
}

// ===== オーケストレーション: Stage0の有効10案件すべてを分析して保存 =====
function analyzeAllPendingJobDetails() {
  assertKnowledgeInSync();

  const appliedMap = loadAppliedJobs();
  const rejectedMap = filterJobStatus(loadJobStatus(), JOB_STATUS.SKIPPED);
  const jobIds = listSavedJobDetailIds();

  const results = [];
  for (const jobId of jobIds) {
    const detail = loadJobDetail(jobId);
    const eligibility = isEligibleForAnalysis(detail, { appliedMap, rejectedMap });
    if (!eligibility.eligible) {
      results.push({ jobId, analyzed: false, skipReason: eligibility.reason });
      continue;
    }
    const analysis = analyzeJobDetail(detail);
    saveJobAnalysis(jobId, analysis);
    results.push({ jobId, analyzed: true, recommendation: analysis.recommendation.value, proposalGenerationAllowed: analysis.proposalGenerationAllowed });
  }
  return results;
}

module.exports = {
  ANALYSIS_VERSION,
  KnowledgeOutOfSyncError,
  assertKnowledgeInSync,
  isEligibleForAnalysis,
  buildEvaluatorInput,
  evaluateWithCategory,
  hasFoodContextConfirmation,
  reverifyCategoryMatch,
  reassessSnsExclusion,
  findToolMentions,
  extractRequiredTools,
  assessToolFit,
  computeEffectiveEvidenceType,
  assetIdFor,
  buildJobSummary,
  buildClientInfo,
  buildRequestSummary,
  buildClientPurpose,
  buildConditions,
  detectSoftResponseItemsSignal,
  finalizeRequiredToolCondition,
  assessFit,
  buildFitAssessment,
  buildUsableExperienceAndEvidence,
  buildClientValueChain,
  buildMissingInformation,
  buildPortfolioCandidates,
  buildSafetyReview,
  buildRecommendation,
  buildProposalMaterials,
  emptyProposalMaterials,
  buildAiHandoff,
  checkKnowledgeConsistency,
  analyzeJobDetail,
  analyzeAllPendingJobDetails,
};
