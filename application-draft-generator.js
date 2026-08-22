// 応募文・応募時質問への回答案（Application Draft）生成
//
// Application Packet（data/private/application_packets/、Stage1＋存在すればStage2の結果を
// まとめた構造化データ）だけを入力に、CrowdWorksへそのまま貼れる応募文と、応募時に求められる
// 質問への回答案、ゆうき本人の確認が必要な項目を生成する。案件本文・Stage1ファイルを
// 読み直すことはしない（Application Packetに無い情報は使わない）。
//
// Anthropic APIが現在利用できない（401等）状況でも既存の日次パイプラインを止めないため、
// このモジュールは単体で完結し、run.jsへはまだ接続しない。API呼び出し部分はStage2
// （ai-analyzer.js）と同じ設計（クライアント注入・JSON Schema制約出力・事実不整合は
// 再試行しない・APIキー未設定時は安全停止）を踏襲する。
//
// 安全設計：
//   - Application Packetに存在しない経験・実績（usableExperience／clientValueのid）を
//     参照した回答は不整合として拒否する
//   - avoidExpressions／prohibitedClaims（禁止数値・自主制作物の受注実績化等）に該当する
//     内容が生成された場合は拒否する
//   - Packet内のどの事実にも見つからない数値主張（推測による年数・金額・件数等）は拒否する
//   - status="ready"以外の回答（needs_confirmation／cannot_answer）は、AIの出力に関わらず
//     コード側でanswerを必ずnullへ強制する（推測回答が保存物に混入することを構造的に防ぐ）
//   - 応募時の質問は事前にルールベースで1問ずつへ分解し、AI出力の件数・質問文が完全一致
//     しない場合は再試行せず失敗とする（質問の統合・省略・言い換えを許さない）
//   - 生成に失敗しても、既存の成功済みドラフト・Application Packet・Stage0/1/2のファイルは
//     一切変更しない（失敗記録は別ディレクトリへ分離保存する）
const Anthropic = require('@anthropic-ai/sdk');
const { ApiKeyNotConfiguredError, assertApiKeyConfigured, isRetryableApiError } = require('./ai-analyzer');
const { estimateCostUsd } = require('./ai-usage-log');
const { loadApplicationPacket } = require('./application-packet-store');
const { saveApplicationDraft, saveFailedDraftAttempt } = require('./application-draft-store');

const DRAFT_VERSION = 'application-draft-v1';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_COST_LIMIT_USD = 3;
const MAX_RETRIES = 2; // 一時的エラー・JSON形式不正のみ対象。事実不整合・構造不一致は即失敗（再試行しない）。

// ===== 質問分解（ルールベース。AIを使わず機械的に1問=1要素へ分解する） =====
// Application Packetのapplicationquestions.responseItemsは、見出し完全一致で抽出できた場合は
// 複数質問がまとめて1つのテキストブロックのまま、見出し不一致でソフトシグナルのみ拾えた場合は
// 前後を含む生の抜粋のまま保持されている。フォーム自動入力工程が質問単位で扱えるよう、
// ここで丸数字（①②③…）・半角数字（1. 1) 1、）・箇条書き（・）を目印に1問ずつへ分解する。
const QUESTION_MARKER_RE = /^([①-⑳]|[0-9]{1,2}[.、)）]|・)/;
const SECTION_HEADING_RE = /^[【■★#◆▼「]/;

function splitQuestionsFromText(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const segments = [];
  let current = null;
  let sawMarker = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (SECTION_HEADING_RE.test(line) && sawMarker) {
      // 質問リストの後に新しいセクション見出しが現れたら、そこで打ち切る
      // （ソフトシグナル抜粋に含まれる無関係な後続セクションの箇条書きを質問として拾わないため）。
      break;
    }
    if (QUESTION_MARKER_RE.test(line)) {
      sawMarker = true;
      if (current !== null) segments.push(current.trim());
      current = line;
      continue;
    }
    if (current !== null && line !== '') {
      // マーカーの無い継続行（複数行にまたがる質問の説明文）は直前の質問へ連結する。
      current += '\n' + line;
    }
    // マーカー到達前の前置き文（挨拶・導入文）は無視する。
  }
  if (current !== null) segments.push(current.trim());

  if (segments.length === 0) {
    // マーカーが1つも見つからない場合は、全体を1件の質問として扱う（推測で分割しない）。
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }
  return segments;
}

// ===== AIへの固定指示 =====
const DRAFT_SYSTEM_PROMPT = `あなたはクラウドソーシング案件への応募文と、応募時に求められる質問への回答案を作成するアシスタントです。与えられたJSON（Application Packet由来の情報のみ）だけを根拠に、指定されたJSON構造で出力してください。以下を必ず守ってください。

1. 与えられたJSON（usableExperience・clientValue・centralMessage・案件本文等）にある情報だけを使用する。それ以外の知識で経験・実績・ツール・稼働状況を補わない。
2. 応募文（applicationText）は「経験 → 能力 → 根拠 → クライアント価値」の流れを基本とし、クライアントの目的・求められている能力・案件との具体的な接点に沿って毎回組み立てる。定型文の単純な差し替えはしない。
3. AIを使えること自体を応募文の主役にしない。
4. avoidExpressionsに列挙された表現、prohibitedClaimsに列挙された数値・実績主張は、理由を問わず一切使用しない。
5. candidateQuestionsに渡された質問は、順序・文言を変更せず、必ず同じ件数・同じ質問文でquestionAnswersへ1件ずつ対応させる（質問の統合・分割・省略・言い換えをしない）。
6. 各質問への回答は、usableExperience・clientValueに根拠がある場合のみstatus="ready"とし、usedExperienceIdsに実在するidを必ず含める。根拠がない場合はanswerを推測で埋めず、status="needs_confirmation"（本人確認で埋まる可能性がある）またはstatus="cannot_answer"（Packet上に手がかりがない）とする。
7. 稼働可能時間・希望納期・見積金額・案件固有の経験有無など、ゆうき本人しか確定できない情報は、Packetに値が無い限り絶対に推測で埋めない。
8. 応募文（applicationText）と質問への回答（questionAnswers）の間で事実の矛盾を起こさない（同じ経験・同じ実績には常に同じ表現を使う）。
9. confirmationItemsには、あなたが判断した「ゆうき本人の確認が必要な項目」を追加してよいが、Packetに存在しない新しい事実を作って理由にしない。
10. 指定されたJSON以外の文章（前置き・説明・コードブロック記法）を一切出力しない。`;

// ===== 出力JSONスキーマ（Structured Outputsでこの形以外を受け付けない） =====
const QUESTION_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    answer: { type: 'string' }, // status!=="ready"の場合、finalizeDraft側で必ずnullへ変換する
    status: { type: 'string', enum: ['ready', 'needs_confirmation', 'cannot_answer'] },
    reasoning: { type: 'string' },
    usedExperienceIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['question', 'answer', 'status', 'reasoning', 'usedExperienceIds'],
  additionalProperties: false,
};

const CONFIRMATION_ITEM_SCHEMA = {
  type: 'object',
  properties: { item: { type: 'string' }, reason: { type: 'string' } },
  required: ['item', 'reason'],
  additionalProperties: false,
};

const DRAFT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    jobId: { type: 'string' },
    applicationText: { type: 'string' },
    applicationTextUsedExperienceIds: { type: 'array', items: { type: 'string' } },
    questionAnswers: { type: 'array', items: QUESTION_ANSWER_SCHEMA },
    confirmationItems: { type: 'array', items: CONFIRMATION_ITEM_SCHEMA },
    selfReport: {
      type: 'object',
      properties: {
        usedOnlyPacketFacts: { type: 'boolean' },
        inventedFactsDetected: { type: 'boolean' },
      },
      required: ['usedOnlyPacketFacts', 'inventedFactsDetected'],
      additionalProperties: false,
    },
  },
  required: ['jobId', 'applicationText', 'applicationTextUsedExperienceIds', 'questionAnswers', 'confirmationItems', 'selfReport'],
  additionalProperties: false,
};

// ===== Application Packet → AI入力ペイロードの構築 =====
function buildDraftInput(packet, candidateQuestions) {
  return {
    jobId: packet.jobId,
    title: packet.job.title,
    jobDescriptionFull: packet.job.description,
    price: packet.job.price,
    deadline: packet.job.deadline,
    requiredCapabilities: packet.requiredCapabilities,
    usableExperience: (packet.usableExperience || []).map(e => ({
      id: e.id, name: e.name, knowledgeText: e.knowledgeText, connectionReason: e.connectionReason, evidenceLevel: e.evidenceLevel,
    })),
    clientValue: (packet.clientValue || []).map(c => ({
      assetId: c.assetId, experience: c.experience, capability: c.capability, clientValue: c.clientValue, expressionExample: c.expressionExample,
    })),
    centralMessage: packet.usableFactsForProposal.centralMessage,
    portfolioCandidates: packet.usableFactsForProposal.portfolioCandidates,
    avoidExpressions: packet.usableFactsForProposal.avoidExpressions,
    prohibitedClaims: packet.usableFactsForProposal.prohibitedClaims,
    concerns: packet.concerns,
    missingInformation: packet.missingInformation,
    requiredConditions: packet.applicationQuestions.requiredConditions,
    candidateQuestions, // 事前にルールベースで分解済みの質問一覧（1問=1要素をAI出力へ強制するための入力）
    stage2Insight: packet.stage2 && packet.stage2.status === 'success' ? {
      deeperGoal: packet.stage2.output.clientPurpose ? packet.stage2.output.clientPurpose.deeperGoal : null,
      personalizationPoints: packet.stage2.output.personalizationPoints || [],
    } : null,
  };
}

// ===== 出力検証 =====
const FORBIDDEN_OUTPUT_KEYS = ['evaluation', 'recommendation', 'client', 'job', 'price', 'deadline', 'usableExperience', 'clientValue', 'concerns', 'missingInformation'];

function collectValidExperienceIds(packet) {
  const ids = new Set();
  (packet.usableExperience || []).forEach(e => { if (e.id) ids.add(e.id); });
  (packet.clientValue || []).forEach(c => { if (c.assetId) ids.add(c.assetId); });
  return ids;
}

function containsBannedString(text, bannedList) {
  return (bannedList || []).filter(b => b && text.includes(b));
}

// prohibitedClaimsは「数値「X」は要確認情報のため使用しない」のような注意文そのもの。
// 数値部分（「」内）だけを厳格に禁止する（自主制作物の名称そのものは、正しい注意書き付きの
// 紹介として使ってよいため、名称全体を一律禁止にはしない＝portfolioCandidatesの使用を妨げない）。
function extractProhibitedNumericStrings(prohibitedClaims) {
  const out = [];
  (prohibitedClaims || []).forEach(p => {
    if (/数値/.test(p)) {
      const m = p.match(/「([^」]+)」/);
      if (m) out.push(m[1]);
    }
  });
  return out;
}

// 生成テキスト中の数値（金額・年数・件数等）が、Packet内のどの事実（本文・使える経験・
// 提供価値・中心メッセージ・報酬/期限）にも見つからない場合、推測による数値の可能性として拒否する。
const NUMERIC_CLAIM_RE = /[0-9０-９]+(?:[.,][0-9]+)?\s*(?:円|万円|年|ヶ月|か月|カ月|時間|件|名|人|回|％|%|ページ|記事|本)/g;
function extractNumericClaims(text) {
  return [...(text || '').matchAll(NUMERIC_CLAIM_RE)].map(m => m[0]);
}
function buildAllowedFactsText(packet) {
  const parts = [
    packet.job.description,
    packet.job.price && packet.job.price.raw,
    packet.job.deadline && packet.job.deadline.raw,
    packet.usableFactsForProposal.centralMessage,
    ...((packet.usableExperience || []).map(e => e.knowledgeText)),
    ...((packet.clientValue || []).map(c => `${c.experience} ${c.expressionExample || ''}`)),
    ...((packet.usableFactsForProposal.portfolioCandidates || []).map(p => p.assetName)),
  ];
  return parts.filter(Boolean).join('\n');
}

function validateDraftOutput(parsed, packet, candidateQuestions) {
  const errors = [];
  let retryable = true;

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['出力がJSONオブジェクトではない'], retryable: true };
  }

  if (parsed.jobId !== packet.jobId) {
    errors.push(`jobId不一致（期待:${packet.jobId} 実際:${parsed.jobId}）`);
    retryable = false;
  }

  FORBIDDEN_OUTPUT_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      errors.push(`Application Packet確定情報のフィールド「${key}」をAI出力へ含めてはいけない`);
      retryable = false;
    }
  });

  // 1問=1要素の構造保証：件数と質問文の完全一致を必須にする（重要追加条件）。
  if (!Array.isArray(parsed.questionAnswers) || parsed.questionAnswers.length !== candidateQuestions.length) {
    errors.push(`questionAnswersの件数が候補質問数と一致しない（候補:${candidateQuestions.length} 出力:${Array.isArray(parsed.questionAnswers) ? parsed.questionAnswers.length : '配列でない'}）`);
    retryable = false;
  } else {
    candidateQuestions.forEach((q, i) => {
      if (parsed.questionAnswers[i].question !== q) {
        errors.push(`questionAnswers[${i}]の質問文が入力候補と一致しない（質問の統合・省略・言い換えをしてはいけない）`);
        retryable = false;
      }
    });
  }

  const validIds = collectValidExperienceIds(packet);
  const referencedIds = [
    ...(parsed.applicationTextUsedExperienceIds || []),
    ...((parsed.questionAnswers || []).flatMap(qa => qa.usedExperienceIds || [])),
  ];
  const invalidIds = referencedIds.filter(id => !validIds.has(id));
  if (invalidIds.length > 0) {
    errors.push(`Application Packetに存在しない経験ID参照（創作扱い）: ${[...new Set(invalidIds)].join('・')}`);
    retryable = false;
  }

  // ready状態は根拠（usedExperienceIds）・回答本文が必須。根拠のない断定回答を防ぐ。
  (parsed.questionAnswers || []).forEach((qa, i) => {
    if (qa.status === 'ready' && (!qa.usedExperienceIds || qa.usedExperienceIds.length === 0)) {
      errors.push(`questionAnswers[${i}]がstatus=readyなのに根拠（usedExperienceIds）が空`);
      retryable = false;
    }
    if (qa.status === 'ready' && (!qa.answer || qa.answer.trim() === '')) {
      errors.push(`questionAnswers[${i}]がstatus=readyなのにanswerが空`);
      retryable = false;
    }
  });

  const allGeneratedText = [parsed.applicationText, ...(parsed.questionAnswers || []).map(qa => qa.answer)].filter(Boolean).join('\n');

  const avoidHits = containsBannedString(allGeneratedText, packet.usableFactsForProposal.avoidExpressions);
  if (avoidHits.length > 0) {
    errors.push(`avoidExpressionsに該当する表現が含まれる: ${avoidHits.join('・')}`);
    retryable = false;
  }

  const prohibitedNumeric = extractProhibitedNumericStrings(packet.usableFactsForProposal.prohibitedClaims);
  const prohibitedHits = containsBannedString(allGeneratedText, prohibitedNumeric);
  if (prohibitedHits.length > 0) {
    errors.push(`prohibitedClaimsで禁止された数値が含まれる: ${prohibitedHits.join('・')}`);
    retryable = false;
  }

  const allowedFactsText = buildAllowedFactsText(packet);
  const numericClaims = extractNumericClaims(allGeneratedText);
  const unverifiedNumbers = numericClaims.filter(n => !allowedFactsText.includes(n));
  if (unverifiedNumbers.length > 0) {
    errors.push(`Application Packet内のどの事実にも見つからない数値の主張がある（推測の可能性）: ${[...new Set(unverifiedNumbers)].join('・')}`);
    retryable = false;
  }

  if (parsed.selfReport && parsed.selfReport.inventedFactsDetected === true) {
    errors.push('AI自己申告で事実の創作を検知した（selfReport.inventedFactsDetected=true）');
    retryable = false;
  }

  if (errors.length > 0) return { valid: false, errors, retryable };
  return { valid: true, errors: [], retryable: true };
}

// ===== 確認事項の合成 =====
// Application Packetが既に「Knowledge上で確定できなかったもの」として持っている情報
// （missingInformation／concerns.toolIssues／単価が相談制等）は、AIの判断を待たず
// 機械的にconfirmationItemsへ含める（Knowledgeで確定できる内容を不要に確認事項へ回さない、
// かつAIが見落としても本人確認が必要な項目が漏れないようにするため）。
function deriveDeterministicConfirmationItems(packet, finalizedQuestionAnswers) {
  const items = [];
  (packet.missingInformation || []).forEach(m => {
    items.push({ item: m.item, reason: m.reason });
  });
  (packet.concerns.toolIssues || []).forEach(t => {
    items.push({ item: `${t.tool}の使用可否確認`, reason: t.reason });
  });
  const priceRaw = packet.job.price && packet.job.price.raw;
  if (!priceRaw || /相談/.test(priceRaw)) {
    items.push({ item: '見積金額', reason: '単価が相談制、または金額が未確定のため、ゆうき本人による見積もりが必要' });
  }
  (finalizedQuestionAnswers || []).forEach(qa => {
    if (qa.status !== 'ready') {
      items.push({
        item: qa.question,
        reason: qa.status === 'needs_confirmation'
          ? '案件本文の質問に対しKnowledge・Application Packet上で確定できる回答がないため、本人確認が必要'
          : 'Knowledge・Application Packet上に回答の根拠が存在しないため',
      });
    }
  });
  return items;
}

function dedupeConfirmationItems(items) {
  const seen = new Set();
  return items.filter(c => {
    const key = c.item.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// AI出力を最終保存形へ変換する。status!=="ready"の回答は、AIが何を書いていても
// 必ずnullへ強制する（推測回答が保存物へ混入することをコード側で構造的に防ぐ）。
function finalizeDraft(parsed, packet) {
  const questionAnswers = (parsed.questionAnswers || []).map(qa => ({
    question: qa.question,
    answer: qa.status === 'ready' ? qa.answer : null,
    status: qa.status,
  }));

  const deterministic = deriveDeterministicConfirmationItems(packet, questionAnswers);
  const aiProvided = (parsed.confirmationItems || []).map(c => ({ item: c.item, reason: c.reason }));
  const confirmationItems = dedupeConfirmationItems([...deterministic, ...aiProvided]);

  return { questionAnswers, confirmationItems };
}

// ===== コスト管理（Stage2のstage2_run_log.jsonとは分離。単価表のみ流用し、永続ログは持たない） =====
function createDraftCostTracker({ costLimitUsd, maxInputTokensPerCall = 20000, maxOutputTokensPerCall = 8000 } = {}) {
  let cumulativeCostUsd = 0;
  const calls = [];
  return {
    get cumulativeCostUsd() { return cumulativeCostUsd; },
    get calls() { return calls; },
    canProceed() {
      if (costLimitUsd == null) return { ok: true };
      if (cumulativeCostUsd >= costLimitUsd) {
        return { ok: false, reason: `累計費用が上限（$${costLimitUsd}）に達しているため処理を停止` };
      }
      return { ok: true };
    },
    checkAbnormalUsage(inputTokens, outputTokens) {
      if (inputTokens > maxInputTokensPerCall) {
        return { abnormal: true, reason: `入力トークン数が異常に多い（${inputTokens} > ${maxInputTokensPerCall}）` };
      }
      if (outputTokens > maxOutputTokensPerCall) {
        return { abnormal: true, reason: `出力トークン数が異常に多い（${outputTokens} > ${maxOutputTokensPerCall}）` };
      }
      return { abnormal: false, reason: null };
    },
    recordCall({ jobId, model, inputTokens, outputTokens, success, retryCount, errorType }) {
      const costUsd = estimateCostUsd(model, inputTokens, outputTokens);
      cumulativeCostUsd += costUsd;
      const entry = {
        jobId, executedAt: new Date().toISOString(), model, inputTokens, outputTokens,
        estimatedCostUsd: Number(costUsd.toFixed(6)), cumulativeCostUsdAfter: Number(cumulativeCostUsd.toFixed(6)),
        success, retryCount, errorType: errorType || null,
      };
      calls.push(entry);
      return entry;
    },
  };
}

// ===== 1案件分のApplication Draft生成（最大 MAX_RETRIES+1 回まで試行） =====
async function generateApplicationDraft(client, jobId, { model, costTracker }) {
  const packet = loadApplicationPacket(jobId);
  if (!packet) {
    return { jobId, outcome: 'skipped', reason: 'Application Packet（data/private/application_packets/）が見つからない' };
  }

  const preCheck = costTracker.canProceed();
  if (!preCheck.ok) {
    return { jobId, outcome: 'skipped', reason: preCheck.reason };
  }

  const responseItems = packet.applicationQuestions.responseItems || {};
  const rawQuestionText = responseItems.status === 'extracted' ? responseItems.value : responseItems.evidenceText;
  const candidateQuestions = splitQuestionsFromText(rawQuestionText);
  const input = buildDraftInput(packet, candidateQuestions);

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
        system: DRAFT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: { format: { type: 'json_schema', schema: DRAFT_OUTPUT_SCHEMA } },
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

    const validation = validateDraftOutput(parsed, packet, candidateQuestions);
    if (!validation.valid) {
      lastError = { type: 'validation_failed', message: validation.errors.join('; ') };
      costTracker.recordCall({ jobId, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, success: false, retryCount: attempt - 1, errorType: 'validation_failed' });
      if (!validation.retryable || attempt > MAX_RETRIES) break;
      continue;
    }

    // 成功：Application Packet・Stage0/1/2のファイルには一切触れず、別ファイルへ保存する。
    costTracker.recordCall({ jobId, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, success: true, retryCount: attempt - 1, errorType: null });
    const { questionAnswers, confirmationItems } = finalizeDraft(parsed, packet);
    const draft = {
      jobId,
      status: 'success',
      applicationText: parsed.applicationText,
      questionAnswers,
      confirmationItems,
      sourcePacket: {
        path: `data/private/application_packets/${jobId}.json`,
        packetVersion: packet.packetVersion,
        packetGeneratedAt: packet.generatedAt,
      },
      generatedAt: new Date().toISOString(),
      draftVersion: DRAFT_VERSION,
      model: { provider: 'anthropic', name: model },
      usage: lastUsage,
      attempts: attempt,
    };
    saveApplicationDraft(jobId, draft);
    return { jobId, outcome: 'success', attempts: attempt, usage: lastUsage, draft };
  }

  const failureRecord = {
    jobId, draftVersion: DRAFT_VERSION, attemptedAt: new Date().toISOString(), model, attempts: attempt, lastError, lastUsage,
  };
  const failedRecordPath = saveFailedDraftAttempt(jobId, failureRecord);
  return { jobId, outcome: 'failed', attempts: attempt, error: lastError, usage: lastUsage, failedRecordPath };
}

// ===== 複数案件の一括実行 =====
async function generateApplicationDraftsForJobIds(jobIds, options = {}) {
  assertApiKeyConfigured();

  const model = options.model || process.env.DRAFT_MODEL || DEFAULT_MODEL;
  const costLimitUsd = options.costLimitUsd != null
    ? options.costLimitUsd
    : (process.env.DRAFT_COST_LIMIT_USD ? Number(process.env.DRAFT_COST_LIMIT_USD) : DEFAULT_COST_LIMIT_USD);
  const costTracker = createDraftCostTracker({ costLimitUsd });

  const client = new Anthropic(); // ANTHROPIC_API_KEYを自動解決（キー自体はコードに書かない）

  const results = [];
  for (const jobId of jobIds) {
    const preCheck = costTracker.canProceed();
    if (!preCheck.ok) {
      results.push({ jobId, outcome: 'skipped', reason: preCheck.reason });
      continue;
    }
    const result = await generateApplicationDraft(client, jobId, { model, costTracker });
    results.push(result);
  }

  return {
    model, costLimitUsd, results,
    cumulativeCostUsd: costTracker.cumulativeCostUsd,
    calls: costTracker.calls,
  };
}

module.exports = {
  DRAFT_VERSION,
  DEFAULT_MODEL,
  DEFAULT_COST_LIMIT_USD,
  MAX_RETRIES,
  ApiKeyNotConfiguredError,
  assertApiKeyConfigured,
  DRAFT_SYSTEM_PROMPT,
  DRAFT_OUTPUT_SCHEMA,
  splitQuestionsFromText,
  buildDraftInput,
  validateDraftOutput,
  extractProhibitedNumericStrings,
  extractNumericClaims,
  buildAllowedFactsText,
  deriveDeterministicConfirmationItems,
  finalizeDraft,
  createDraftCostTracker,
  generateApplicationDraft,
  generateApplicationDraftsForJobIds,
};
