// Stage2a: 案件分析結果（Stage1）のうち requires_ai_analysis / requires_review のまま保留されていた
// 項目だけをClaude APIで補完する。Stage1が確定させた事実（jobId・報酬・期限・クライアント情報・
// Knowledge証拠・stop判定・proposalGenerationAllowed・証拠レベル等）はAIへ渡すが、AIが書き換える
// 権限は持たない（出力JSONスキーマにそれらのフィールド自体を用意しない）。
//
// 安全設計：
//   - stop判定／proposalGenerationAllowed=falseの案件はAPIへ一切送信しない
//   - ANTHROPIC_API_KEY未設定時は外部送信せず例外で安全停止する
//   - 正規Knowledge（Markdown）とJSキャッシュが同期していない場合は処理しない（Stage1と同じ仕組み）
//   - AI出力はJSON Schema（Structured Outputs）で構造を強制した上、jobId一致・ID参照の実在性・
//     根拠本文の実在性・使用禁止情報の混入をすべて機械的に検証する
//   - 事実不整合（jobId不一致・存在しないID参照・根拠不在・使用禁止情報混入）は再試行せず即失敗とする
//   - 一時的エラー（通信エラー・429・5xx・JSON形式不正）のみ最大2回まで再試行する
//   - 累計費用が上限に達したら以降の案件を処理せず停止する
const Anthropic = require('@anthropic-ai/sdk');
const { assertKnowledgeInSync } = require('./analyzer');
const { loadJobAnalysis } = require('./analysis-store');
const { saveJobAiAnalysis, saveFailedAttempt } = require('./ai-analysis-store');
const { createCostTracker } = require('./ai-usage-log');

const STAGE2_VERSION = 'stage2a-v1';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_COST_LIMIT_USD = 3;
const MAX_RETRIES = 2; // 一時的エラー・JSON形式不正のみ対象。事実不整合は即失敗（再試行しない）。

class ApiKeyNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEYが設定されていないため、Stage2のAI呼び出しを行わずに安全停止しました。.envにANTHROPIC_API_KEYを設定してから再実行してください（永峯勇気の設定作業待ち）。');
    this.name = 'ApiKeyNotConfiguredError';
  }
}

function assertApiKeyConfigured() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === '') {
    throw new ApiKeyNotConfiguredError();
  }
}

// ===== AIへの固定指示（案件をまたいで内容が変わらないためプロンプトキャッシュの対象にできる） =====
const STAGE2_SYSTEM_PROMPT = `あなたは副業クラウドソーシング案件の分析アシスタントです。与えられたJSON（案件本文・Stage1のルールベース分析結果・Knowledge抜粋）だけを根拠に、指定されたJSON構造で出力してください。以下を必ず守ってください。

1. 与えられた案件本文とKnowledge抜粋にある情報だけを使用する。それ以外の知識で経験・実績・ツールを補わない。
2. 不明な内容は推測しない。確信が持てない場合はconfidenceを"low"にするか、unresolvedItemsへ入れる。
3. Knowledgeにない実績・経験・ツール・ポートフォリオ・URLを絶対に作らない。
4. 案件の応募可否（stop・proceed等）を判断・変更する権限はない。それはあなたの担当外であり、出力にも含めない。
5. experienceConnectionsでは、入力のusableExperienceに実在するidだけを参照すること。新しい経験名・実績名を作らない。
6. clientPurpose.deeperGoalには、必ずdeeperGoalEvidenceTextに案件本文からそのまま引用した文字列を1つ以上添えること。引用できない場合はconfidenceを"low"にし、deeperGoalは短く保留的な記述にとどめる。
7. personalizationPointsは案件本文の具体的な記載に基づくものだけを書く。一般論・定型文は書かない。
8. 応募時の回答項目候補は気づいたものを省略しない。
9. 営業的に魅力的にするための誇張・誇大表現を一切しない。mustNotUseに列挙された数値・表現は理由を問わず使わない。
10. 応募文そのもの（完成した文章・挨拶文）は書かない。断片的な分析材料のみを出力する。
11. 指定されたJSON以外の文章（前置き・後書き・説明・コードブロック記法）を一切出力しない。`;

// ===== 出力JSONスキーマ（Structured Outputsでこの形以外を受け付けない） =====
const EVIDENCE_ITEM_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'string' }, evidenceText: { type: 'string' } },
  required: ['value', 'evidenceText'],
  additionalProperties: false,
};

const STAGE2_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    jobId: { type: 'string' },
    clientPurpose: {
      type: 'object',
      properties: {
        deeperGoal: { type: 'string' },
        deeperGoalEvidenceText: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['deeperGoal', 'deeperGoalEvidenceText', 'confidence'],
      additionalProperties: false,
    },
    conditionsSupplement: {
      type: 'object',
      properties: {
        requiredEmbedded: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
        welcomeEmbedded: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
        responseItemsResolved: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
      },
      required: ['requiredEmbedded', 'welcomeEmbedded', 'responseItemsResolved'],
      additionalProperties: false,
    },
    personalizationPoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: { point: { type: 'string' }, evidenceText: { type: 'string' } },
        required: ['point', 'evidenceText'],
        additionalProperties: false,
      },
    },
    safetyReviewSupplement: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          assessment: { type: 'string' },
          status: { type: 'string', enum: ['resolved', 'still_unclear'] },
          evidenceText: { type: 'array', items: { type: 'string' } },
        },
        required: ['field', 'assessment', 'status', 'evidenceText'],
        additionalProperties: false,
      },
    },
    experienceConnections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          usableExperienceId: { type: 'string' },
          connectionNote: { type: 'string' },
          fitStrength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
          limitation: { type: 'string' },
        },
        required: ['usableExperienceId', 'connectionNote', 'fitStrength', 'limitation'],
        additionalProperties: false,
      },
    },
    missingInformationAdditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, reason: { type: 'string' } },
        required: ['item', 'reason'],
        additionalProperties: false,
      },
    },
    unresolvedItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, reason: { type: 'string' } },
        required: ['item', 'reason'],
        additionalProperties: false,
      },
    },
    stage2Concerns: {
      type: 'object',
      properties: {
        found: { type: 'boolean' },
        details: { type: 'array', items: { type: 'string' } },
      },
      required: ['found', 'details'],
      additionalProperties: false,
    },
    selfReport: {
      type: 'object',
      properties: {
        usedOnlyProvidedFacts: { type: 'boolean' },
        inventedFactsDetected: { type: 'boolean' },
      },
      required: ['usedOnlyProvidedFacts', 'inventedFactsDetected'],
      additionalProperties: false,
    },
  },
  required: [
    'jobId', 'clientPurpose', 'conditionsSupplement', 'personalizationPoints',
    'safetyReviewSupplement', 'experienceConnections', 'missingInformationAdditions',
    'unresolvedItems', 'stage2Concerns', 'selfReport',
  ],
  additionalProperties: false,
};

// ===== Stage1分析結果 → AI入力ペイロードの構築（Knowledge全文は渡さず、必要部分だけ） =====
function buildStage2Input(stage1Analysis) {
  const safetyReviewUnresolved = {};
  Object.entries(stage1Analysis.safetyReview || {}).forEach(([key, value]) => {
    if (value && value.status === 'requires_review') safetyReviewUnresolved[key] = value;
  });

  const salesKnowledgeRelevant = (stage1Analysis.aiHandoff && stage1Analysis.aiHandoff.input && stage1Analysis.aiHandoff.input.salesKnowledgeRelevant) || null;

  return {
    jobId: stage1Analysis.jobId,
    title: stage1Analysis.jobSummary.title,
    jobDescriptionFull: stage1Analysis.aiHandoff.input.jobDescriptionFull,
    conditions: {
      required: stage1Analysis.conditions.required,
      welcome: stage1Analysis.conditions.welcome,
      responseItems: stage1Analysis.conditions.responseItems,
    },
    toolFit: stage1Analysis.toolFit,
    toolMismatchNote: stage1Analysis.toolMismatchNote,
    searchSystemJudgment: stage1Analysis.searchSystemReevaluation,
    usableExperience: (stage1Analysis.usableExperience || []).map(e => ({
      id: e.id, assetId: e.assetId, name: e.name, knowledgeText: e.knowledgeText, evidenceKind: e.evidenceKind,
    })),
    clientValue: stage1Analysis.clientValue,
    portfolioCandidates: (stage1Analysis.portfolioCandidates || []).map(p => ({ assetId: p.assetId, assetName: p.assetName })),
    missingInformation: stage1Analysis.missingInformation,
    safetyReviewUnresolved,
    salesKnowledgeExcerpt: {
      categoryLabel: salesKnowledgeRelevant ? salesKnowledgeRelevant.categoryLabel : null,
      clientSurfacePurpose: stage1Analysis.clientPurpose.surfacePurpose.value,
      hiringConcerns: stage1Analysis.clientPurpose.hiringConcerns.value,
      properFraming: stage1Analysis.proposalMaterials.centralMessage,
    },
    mustNotUse: stage1Analysis.aiHandoff.input.mustNotUse,
    commonKnowledgeRelevant: stage1Analysis.aiHandoff.input.commonKnowledgeRelevant,
  };
}

// ===== 出力検証 =====
function normalizeForSubstringCheck(s) {
  return String(s || '').replace(/\s+/g, '');
}

function evidenceExistsInText(evidenceText, sourceText) {
  const normEvidence = normalizeForSubstringCheck(evidenceText);
  if (normEvidence.length === 0) return false;
  return normalizeForSubstringCheck(sourceText).includes(normEvidence);
}

const FORBIDDEN_OUTPUT_KEYS = ['recommendation', 'proposalGenerationAllowed', 'price', 'deadline', 'evidenceLevel', 'excludeReason', 'toolFit', 'usableExperience'];

// jobId不一致・存在しないID参照・根拠不在・使用禁止情報混入・Stage1確定フィールドの混入は
// retryable:false（再試行で事実を補完させず、その場で失敗とする）。
function validateStage2Output(parsed, stage1Analysis, jobDescriptionFull) {
  const errors = [];
  let retryable = true;

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['出力がJSONオブジェクトではない'], retryable: true };
  }

  if (parsed.jobId !== stage1Analysis.jobId) {
    errors.push(`jobId不一致（期待:${stage1Analysis.jobId} 実際:${parsed.jobId}）`);
    retryable = false;
  }

  FORBIDDEN_OUTPUT_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      errors.push(`Stage1確定情報のフィールド「${key}」をAI出力へ含めてはいけない`);
      retryable = false;
    }
  });

  const validExperienceIds = new Set((stage1Analysis.usableExperience || []).map(e => e.id));
  (parsed.experienceConnections || []).forEach(ec => {
    if (!validExperienceIds.has(ec.usableExperienceId)) {
      errors.push(`存在しないusableExperienceIdを参照している: ${ec.usableExperienceId}`);
      retryable = false;
    }
  });

  const evidenceTexts = [];
  if (parsed.clientPurpose) (parsed.clientPurpose.deeperGoalEvidenceText || []).forEach(t => evidenceTexts.push(t));
  if (parsed.conditionsSupplement) {
    ['requiredEmbedded', 'welcomeEmbedded', 'responseItemsResolved'].forEach(key => {
      (parsed.conditionsSupplement[key] || []).forEach(e => { if (e.evidenceText) evidenceTexts.push(e.evidenceText); });
    });
  }
  (parsed.personalizationPoints || []).forEach(p => { if (p.evidenceText) evidenceTexts.push(p.evidenceText); });
  (parsed.safetyReviewSupplement || []).forEach(s => (s.evidenceText || []).forEach(t => evidenceTexts.push(t)));

  const missingEvidence = evidenceTexts.filter(t => t && !evidenceExistsInText(t, jobDescriptionFull));
  if (missingEvidence.length > 0) {
    errors.push(`根拠本文が案件本文に見つからない引用が${missingEvidence.length}件ある: ${missingEvidence.slice(0, 3).join(' / ')}`);
    retryable = false;
  }

  const banned = [
    ...((stage1Analysis.aiHandoff.input.mustNotUse.prohibitedNumbers) || []),
    ...((stage1Analysis.aiHandoff.input.mustNotUse.notClientWork) || []),
    ...((stage1Analysis.aiHandoff.input.mustNotUse.prohibitedExpressions) || []),
  ];
  const outputString = JSON.stringify(parsed);
  const foundBanned = banned.filter(b => outputString.includes(b));
  if (foundBanned.length > 0) {
    errors.push(`使用禁止情報が出力に混入: ${foundBanned.join('・')}`);
    retryable = false;
  }

  if (errors.length > 0) return { valid: false, errors, retryable };
  return { valid: true, errors: [], retryable: true };
}

function isRetryableApiError(err) {
  const status = err.status || (err.response && err.response.status);
  if (!status) return true; // ネットワークエラー等（ステータス不明）は再試行対象
  return status === 429 || status >= 500;
}

// ===== 1案件分のStage2実行（最大 MAX_RETRIES+1 回まで試行） =====
async function runStage2ForJob(client, jobId, { model, costTracker }) {
  const stage1Analysis = loadJobAnalysis(jobId);
  if (!stage1Analysis) {
    return { jobId, outcome: 'skipped', reason: 'Stage1分析結果（data/private/job_analysis/）が見つからない' };
  }
  if (stage1Analysis.recommendation.value === 'stop') {
    return { jobId, outcome: 'skipped', reason: `Stage1のrecommendationがstopのためAPIへ送信しない（${stage1Analysis.recommendation.reasons.join('; ')}）` };
  }
  if (stage1Analysis.proposalGenerationAllowed === false) {
    return { jobId, outcome: 'skipped', reason: 'proposalGenerationAllowed=falseのためAPIへ送信しない' };
  }

  const preCheck = costTracker.canProceed();
  if (!preCheck.ok) {
    return { jobId, outcome: 'skipped', reason: preCheck.reason };
  }

  const input = buildStage2Input(stage1Analysis);
  const jobDescriptionFull = stage1Analysis.aiHandoff.input.jobDescriptionFull || '';

  let attempt = 0;
  let lastError = null;
  let lastUsage = null;

  while (attempt <= MAX_RETRIES) {
    attempt++;

    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: STAGE2_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { format: { type: 'json_schema', schema: STAGE2_OUTPUT_SCHEMA } },
      });
    } catch (err) {
      lastError = { type: 'api_error', message: err.message };
      costTracker.recordCall({ jobId, model, inputTokens: 0, outputTokens: 0, success: false, retryCount: attempt - 1, errorType: 'api_error' });
      if (!isRetryableApiError(err) || attempt > MAX_RETRIES) break;
      continue;
    }

    const usage = response.usage || { input_tokens: 0, output_tokens: 0 };
    lastUsage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };

    const abnormal = costTracker.checkAbnormalUsage(usage.input_tokens, usage.output_tokens);
    if (abnormal.abnormal) {
      lastError = { type: 'abnormal_usage', message: abnormal.reason };
      costTracker.recordCall({ jobId, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, success: false, retryCount: attempt - 1, errorType: 'abnormal_usage' });
      break; // 異常検知は再試行しない
    }

    let parsed;
    try {
      const textBlock = (response.content || []).find(b => b.type === 'text');
      parsed = JSON.parse(textBlock ? textBlock.text : '');
    } catch (err) {
      lastError = { type: 'json_parse_error', message: err.message };
      costTracker.recordCall({ jobId, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, success: false, retryCount: attempt - 1, errorType: 'json_parse_error' });
      if (attempt > MAX_RETRIES) break;
      continue; // JSON形式不正は再試行対象
    }

    const validation = validateStage2Output(parsed, stage1Analysis, jobDescriptionFull);
    if (!validation.valid) {
      lastError = { type: 'validation_failed', message: validation.errors.join('; ') };
      costTracker.recordCall({ jobId, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, success: false, retryCount: attempt - 1, errorType: 'validation_failed' });
      if (!validation.retryable || attempt > MAX_RETRIES) break;
      continue;
    }

    // 成功：Stage1の確定フィールドには一切触れず、別ファイルへ保存する
    costTracker.recordCall({ jobId, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, success: true, retryCount: attempt - 1, errorType: null });
    const result = {
      jobId,
      stage2Version: STAGE2_VERSION,
      analyzedAt: new Date().toISOString(),
      model: { provider: 'anthropic', name: model, promptVersion: 'stage2a-prompt-v1' },
      stage1RecommendationAtAnalysis: stage1Analysis.recommendation.value,
      stage1ProposalGenerationAllowedAtAnalysis: stage1Analysis.proposalGenerationAllowed,
      output: parsed,
      usage: lastUsage,
      attempts: attempt,
    };
    saveJobAiAnalysis(jobId, result);
    return { jobId, outcome: 'success', attempts: attempt, usage: lastUsage, result };
  }

  const failureRecord = {
    jobId,
    stage2Version: STAGE2_VERSION,
    attemptedAt: new Date().toISOString(),
    model,
    attempts: attempt,
    lastError,
    lastUsage,
  };
  const failedRecordPath = saveFailedAttempt(jobId, failureRecord);
  return { jobId, outcome: 'failed', attempts: attempt, error: lastError, usage: lastUsage, failedRecordPath };
}

// ===== 複数案件の一括実行（Stage2aは3件固定で呼び出す想定） =====
async function runStage2ForJobIds(jobIds, options = {}) {
  assertApiKeyConfigured();
  assertKnowledgeInSync();

  const model = options.model || process.env.STAGE2_MODEL || DEFAULT_MODEL;
  const costLimitUsd = options.costLimitUsd != null
    ? options.costLimitUsd
    : (process.env.STAGE2_COST_LIMIT_USD ? Number(process.env.STAGE2_COST_LIMIT_USD) : DEFAULT_COST_LIMIT_USD);
  const costTracker = createCostTracker({ costLimitUsd });

  const client = new Anthropic(); // ANTHROPIC_API_KEYを自動解決（キー自体はコードに書かない）

  const results = [];
  for (const jobId of jobIds) {
    const preCheck = costTracker.canProceed();
    if (!preCheck.ok) {
      results.push({ jobId, outcome: 'skipped', reason: preCheck.reason });
      continue;
    }
    const result = await runStage2ForJob(client, jobId, { model, costTracker });
    results.push(result);
  }

  return {
    model,
    costLimitUsd,
    results,
    cumulativeCostUsd: costTracker.cumulativeCostUsd,
    calls: costTracker.calls,
  };
}

module.exports = {
  STAGE2_VERSION,
  DEFAULT_MODEL,
  DEFAULT_COST_LIMIT_USD,
  MAX_RETRIES,
  ApiKeyNotConfiguredError,
  assertApiKeyConfigured,
  STAGE2_SYSTEM_PROMPT,
  STAGE2_OUTPUT_SCHEMA,
  buildStage2Input,
  evidenceExistsInText,
  validateStage2Output,
  isRetryableApiError,
  runStage2ForJob,
  runStage2ForJobIds,
};
