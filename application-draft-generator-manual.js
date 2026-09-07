// Application Draft（応募文・応募時質問への回答案）の manual / APIなし生成モード。
//
// Anthropic APIを直接呼ばず、ゆうきが手動でChatGPT等へ生成プロンプトを貼り付け、
// 返ってきたJSON結果をこのツールへ取り込むことで、application-draft-generator.js と
// 完全に同じ検証・保存の仕組み（validateDraftOutput／finalizeDraft／saveApplicationDraft）を
// 通した Application Draft を作成する。
//
// application-draft-generator.js 自体は一切変更しない。既にエクスポートされている
// 純粋関数（buildDraftInput／splitQuestionsFromText／DRAFT_SYSTEM_PROMPT／
// DRAFT_OUTPUT_SCHEMA／validateDraftOutput／finalizeDraft）だけを再利用する。
//
// このファイルはAnthropic・OpenAI・Gemini・CrowdWorksのいずれにも一切通信しない
// （ファイルの読み書きと文字列処理のみ）。
const fs = require('fs');
const path = require('path');
const {
  DRAFT_VERSION,
  DRAFT_SYSTEM_PROMPT,
  DRAFT_OUTPUT_SCHEMA,
  buildDraftInput,
  splitQuestionsFromText,
  validateDraftOutput,
  finalizeDraft,
} = require('./application-draft-generator');
const { loadApplicationPacket } = require('./application-packet-store');
const { saveApplicationDraft, saveFailedDraftAttempt } = require('./application-draft-store');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const APPLICATION_DRAFT_PROMPTS_DIR = path.join(PRIVATE_DATA_DIR, 'application_draft_prompts');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function promptPath(jobId) {
  return path.join(APPLICATION_DRAFT_PROMPTS_DIR, `${jobId}.txt`);
}

// application-draft-generator.js の generateApplicationDraft() 内にある、
// Application Packetから応募時質問候補を取り出す処理と同じロジック。
// この3行だけを取り出したexportはapplication-draft-generator.js側に無く、
// 同ファイルを変更しない方針のためここに同一ロジックとして複製する
// （プロンプト生成時と結果取り込み時の両方で、同じPacketから同じ手順で
// 同じ質問リストを再現できることが検証（questionAnswersの件数・文言一致）の前提）。
function extractCandidateQuestions(packet) {
  const responseItems = packet.applicationQuestions.responseItems || {};
  const rawQuestionText = responseItems.status === 'extracted' ? responseItems.value : responseItems.evidenceText;
  return splitQuestionsFromText(rawQuestionText);
}

// ===== manualモード補足指示（制作物例・提案例の条件付き提示） =====
// DRAFT_SYSTEM_PROMPT自体は変更せず、manualモードのプロンプト組み立て時だけ追記する。
// 新しい出力項目（schema）は増やさない。制作物例もapplicationText本文の一部として書かせる。
const MANUAL_SUPPLEMENTARY_INSTRUCTIONS = `補足指示（制作物例・提案例について）：

・すべての案件に具体的な制作物例・提案例を書く必要はない。強制しない。
・Application Packet（usableExperience・clientValue・centralMessage・portfolioCandidates・案件本文）の情報から、この案件で受注可能性を高めるのに有効だと判断できる場合のみ、含める。
・含める場合は、新しい出力項目（schemaのフィールド）を追加せず、applicationText本文の中に自然な文章として組み込む。
・制作物例として書いてよい内容の例：成果物の構成例／提案内容の具体例／進め方／納品物イメージ。
・架空の実績・未確認の数値・Application Packetに存在しない経験や能力を、制作物例のためだけに作らない（他の指示と同様、Packetにある情報だけを根拠にする）。
・既存のポートフォリオ（portfolioCandidates）を制作物例として使う場合も、Application Packet上でこの案件との関連性・根拠が確認できるものに限る。
・制作物例を書く場合も単なる実績紹介で終わらせず、「経験 → 能力 → 根拠 → この案件への提供価値」の流れの中に位置づける。`;

// ===== 1. 生成プロンプト出力 =====
function buildGenerationPrompt(jobId) {
  const packet = loadApplicationPacket(jobId);
  if (!packet) {
    return { ok: false, reason: `Application Packet（data/private/application_packets/${jobId}.json）が見つからない` };
  }

  const candidateQuestions = extractCandidateQuestions(packet);
  const input = buildDraftInput(packet, candidateQuestions);

  const promptText = [
    DRAFT_SYSTEM_PROMPT,
    '',
    MANUAL_SUPPLEMENTARY_INSTRUCTIONS,
    '',
    '--- 入力データ（このJSONに書かれている情報だけを根拠にしてください） ---',
    JSON.stringify(input, null, 2),
    '',
    '--- 出力してください（このJSON Schemaに一致する1つのJSONオブジェクトのみ。前置き・説明・コードブロック記法は禁止） ---',
    JSON.stringify(DRAFT_OUTPUT_SCHEMA, null, 2),
  ].join('\n');

  return { ok: true, jobId, packet, candidateQuestions, input, promptText };
}

function writeGenerationPrompt(jobId) {
  const built = buildGenerationPrompt(jobId);
  if (!built.ok) return built;

  ensureDir(APPLICATION_DRAFT_PROMPTS_DIR);
  const filePath = promptPath(jobId);
  fs.writeFileSync(filePath, built.promptText, 'utf8');
  return { ok: true, jobId, filePath };
}

// ===== 3. JSON前処理（ChatGPT等が前置き文・コードブロック記法を付けて返す場合を吸収） =====
// validateDraftOutput自体は変更せず、そこへ渡す「parsed」を得るための前段処理のみ。
function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { ok: false, reason: '結果テキストが空、または文字列ではない' };
  }

  const candidates = [];

  // ```json ... ``` または ``` ... ``` で囲まれている場合、その中身を最優先候補にする。
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidates.push(fenceMatch[1]);

  // 全体をそのまま（前置き・後書きが無い場合）。
  candidates.push(rawText);

  // 前後に説明文が付いている場合の最終手段：最初の「{」から最後の「}」までを抜き出す。
  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(rawText.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const trimmed = (candidate || '').trim();
    if (!trimmed) continue;
    try {
      return { ok: true, parsed: JSON.parse(trimmed) };
    } catch {
      // 次の候補を試す
    }
  }

  return { ok: false, reason: 'JSONとして解析できる部分が見つからなかった（前置き文の除去・コードブロックの確認をしてください）' };
}

// ===== 2. ChatGPT等の結果取り込み =====
// application-draft-generator.js の generateApplicationDraft() 成功時と同じ形の
// draftオブジェクトを組み立てる。provider/modelだけ manual であることを明示する。
function importManualDraftResult(jobId, rawResultText, options = {}) {
  const packet = loadApplicationPacket(jobId);
  if (!packet) {
    return { jobId, outcome: 'skipped', reason: `Application Packet（data/private/application_packets/${jobId}.json）が見つからない` };
  }

  const extracted = extractJsonFromText(rawResultText);
  if (!extracted.ok) {
    const failureRecord = {
      jobId,
      draftVersion: DRAFT_VERSION,
      attemptedAt: new Date().toISOString(),
      source: 'manual',
      modelName: options.modelName || null,
      lastError: { type: 'json_parse_error', message: extracted.reason },
    };
    const failedRecordPath = saveFailedDraftAttempt(jobId, failureRecord);
    return { jobId, outcome: 'failed', error: failureRecord.lastError, failedRecordPath };
  }

  const candidateQuestions = extractCandidateQuestions(packet);
  const validation = validateDraftOutput(extracted.parsed, packet, candidateQuestions);
  if (!validation.valid) {
    const failureRecord = {
      jobId,
      draftVersion: DRAFT_VERSION,
      attemptedAt: new Date().toISOString(),
      source: 'manual',
      modelName: options.modelName || null,
      lastError: { type: 'validation_failed', message: validation.errors.join('; ') },
    };
    const failedRecordPath = saveFailedDraftAttempt(jobId, failureRecord);
    return { jobId, outcome: 'failed', error: failureRecord.lastError, failedRecordPath };
  }

  // 成功：Application Packet・Stage0/1/2のファイルには一切触れず、別ファイルへ保存する
  // （application-draft-generator.js の成功時と同一の保存経路・同一の形状）。
  const { questionAnswers, confirmationItems } = finalizeDraft(extracted.parsed, packet);
  const draft = {
    jobId,
    status: 'success',
    applicationText: extracted.parsed.applicationText,
    questionAnswers,
    confirmationItems,
    sourcePacket: {
      path: `data/private/application_packets/${jobId}.json`,
      packetVersion: packet.packetVersion,
      packetGeneratedAt: packet.generatedAt,
    },
    generatedAt: new Date().toISOString(),
    draftVersion: DRAFT_VERSION,
    model: { provider: 'manual', name: options.modelName || 'manual-unspecified' },
    usage: null,
    attempts: 1,
  };
  saveApplicationDraft(jobId, draft);
  return { jobId, outcome: 'success', draft };
}

function importManualDraftResultFromFile(jobId, resultFilePath, options = {}) {
  let rawResultText;
  try {
    rawResultText = fs.readFileSync(resultFilePath, 'utf8');
  } catch (err) {
    return { jobId, outcome: 'skipped', reason: `結果ファイルを読み込めない（${resultFilePath}）: ${err.message}` };
  }
  return importManualDraftResult(jobId, rawResultText, options);
}

module.exports = {
  PRIVATE_DATA_DIR,
  APPLICATION_DRAFT_PROMPTS_DIR,
  MANUAL_SUPPLEMENTARY_INSTRUCTIONS,
  promptPath,
  extractCandidateQuestions,
  buildGenerationPrompt,
  writeGenerationPrompt,
  extractJsonFromText,
  importManualDraftResult,
  importManualDraftResultFromFile,
};

if (require.main === module) {
  const [, , command, jobId, arg3, arg4] = process.argv;

  function printUsage() {
    console.log('使い方:');
    console.log('  node application-draft-generator-manual.js prompt <jobId>');
    console.log('  node application-draft-generator-manual.js import <jobId> <result-file> [modelName]');
  }

  if (!command || !jobId) {
    printUsage();
    process.exit(1);
  }

  if (command === 'prompt') {
    const result = writeGenerationPrompt(jobId);
    if (!result.ok) {
      console.error(`❌ ${result.reason}`);
      process.exit(1);
    }
    console.log(`✅ 生成プロンプトを書き出しました: ${result.filePath}`);
    console.log('このファイルの中身をそのままChatGPT等へ貼り付けてください。');
  } else if (command === 'import') {
    if (!arg3) {
      printUsage();
      process.exit(1);
    }
    const result = importManualDraftResultFromFile(jobId, arg3, { modelName: arg4 || null });
    if (result.outcome !== 'success') {
      console.error(`❌ 取り込み失敗: ${result.reason || (result.error && result.error.message)}`);
      if (result.failedRecordPath) console.error(`   詳細: ${result.failedRecordPath}`);
      process.exit(1);
    }
    console.log(`✅ Application Draftを保存しました（jobId=${jobId}）`);
    console.log(`   保存先: data/private/application_drafts/${jobId}.json`);
    if (result.draft.confirmationItems.length > 0) {
      console.log(`   要確認事項: ${result.draft.confirmationItems.length}件`);
    }
  } else {
    printUsage();
    process.exit(1);
  }
}
