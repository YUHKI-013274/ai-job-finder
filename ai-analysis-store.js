// Stage2（AI意味解析結果）を非公開のローカルデータとして保存する。
// data/private/ 配下は .gitignore で除外済み。Stage0（job_details）・Stage1（job_analysis）の
// ファイルは一切上書きしない（別ディレクトリ）。
// 失敗した出力（検証不合格・再試行尽きた等）は正式なStage2結果と分離して保存する。
const fs = require('fs');
const path = require('path');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const JOB_AI_ANALYSIS_DIR = path.join(PRIVATE_DATA_DIR, 'job_ai_analysis');
const JOB_AI_ANALYSIS_FAILED_DIR = path.join(PRIVATE_DATA_DIR, 'job_ai_analysis_failed');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function jobAiAnalysisPath(jobId) {
  return path.join(JOB_AI_ANALYSIS_DIR, `${jobId}.json`);
}

function saveJobAiAnalysis(jobId, result) {
  ensureDir(JOB_AI_ANALYSIS_DIR);
  fs.writeFileSync(jobAiAnalysisPath(jobId), JSON.stringify(result, null, 2), 'utf8');
}

function loadJobAiAnalysis(jobId) {
  try {
    return JSON.parse(fs.readFileSync(jobAiAnalysisPath(jobId), 'utf8'));
  } catch {
    return null;
  }
}

// 失敗記録は同一jobIdで複数回試行しても上書きされないよう、試行時刻をファイル名に含める。
function saveFailedAttempt(jobId, failureRecord) {
  ensureDir(JOB_AI_ANALYSIS_FAILED_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(JOB_AI_ANALYSIS_FAILED_DIR, `${jobId}_${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(failureRecord, null, 2), 'utf8');
  return filePath;
}

function listSavedJobAiAnalysisIds() {
  if (!fs.existsSync(JOB_AI_ANALYSIS_DIR)) return [];
  return fs.readdirSync(JOB_AI_ANALYSIS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

module.exports = {
  PRIVATE_DATA_DIR,
  JOB_AI_ANALYSIS_DIR,
  JOB_AI_ANALYSIS_FAILED_DIR,
  saveJobAiAnalysis,
  loadJobAiAnalysis,
  saveFailedAttempt,
  listSavedJobAiAnalysisIds,
};
