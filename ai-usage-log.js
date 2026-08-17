// Stage2のAPI利用ログ・費用試算・コスト上限チェック。
// ログにはAPIキー・案件本文・AI出力内容は一切書かない（jobId・トークン数・費用・成否のみ）。
const fs = require('fs');
const path = require('path');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const RUN_LOG_PATH = path.join(PRIVATE_DATA_DIR, 'stage2_run_log.json');

// Anthropic公式料金（2026年8月時点、100万トークンあたりUSD）。価格改定時は手動更新が必要。
const PRICING_USD_PER_MILLION = {
  'claude-opus-5': { input: 5.00, output: 25.00 },
  'claude-sonnet-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
};
const DEFAULT_PRICING = PRICING_USD_PER_MILLION['claude-sonnet-5'];

function estimateCostUsd(model, inputTokens, outputTokens) {
  const pricing = PRICING_USD_PER_MILLION[model] || DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadRunLog() {
  try {
    return JSON.parse(fs.readFileSync(RUN_LOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function appendRunLogEntry(entry) {
  ensureDir(PRIVATE_DATA_DIR);
  const log = loadRunLog();
  log.push(entry);
  fs.writeFileSync(RUN_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  return entry;
}

// 実行中セッション（1回のスクリプト実行）の累計費用を追跡し、上限到達を判定する。
// 異常なトークン使用（単発で極端に大きい）も別途検知する。
function createCostTracker({ costLimitUsd, maxInputTokensPerCall = 20000, maxOutputTokensPerCall = 8000 } = {}) {
  let cumulativeCostUsd = 0;
  const calls = [];

  return {
    get cumulativeCostUsd() {
      return cumulativeCostUsd;
    },
    get calls() {
      return calls;
    },
    // 呼び出し前に、上限に達していないか確認する（上限到達後は新規呼び出しを許可しない）。
    canProceed() {
      if (costLimitUsd == null) return { ok: true };
      if (cumulativeCostUsd >= costLimitUsd) {
        return { ok: false, reason: `累計費用が上限（$${costLimitUsd}）に達しているため処理を停止` };
      }
      return { ok: true };
    },
    // 異常なトークン使用の検知（呼び出し後、保存前に確認する）。
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
        jobId,
        executedAt: new Date().toISOString(),
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: Number(costUsd.toFixed(6)),
        cumulativeCostUsdAfter: Number(cumulativeCostUsd.toFixed(6)),
        success,
        retryCount,
        errorType: errorType || null,
      };
      calls.push(entry);
      appendRunLogEntry(entry);
      return entry;
    },
  };
}

module.exports = {
  RUN_LOG_PATH,
  PRICING_USD_PER_MILLION,
  estimateCostUsd,
  loadRunLog,
  createCostTracker,
};
