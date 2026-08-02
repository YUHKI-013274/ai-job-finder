// 案件分析結果（Stage1）を非公開のローカルデータとして保存する。
// data/private/ 配下は .gitignore で除外しており、コミット・push・GitHub Pagesには一切含まれない。
// 案件詳細（data/private/job_details/）とは別ディレクトリに保存し、詳細JSONを上書きしない。
const fs = require('fs');
const path = require('path');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const JOB_ANALYSIS_DIR = path.join(PRIVATE_DATA_DIR, 'job_analysis');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function jobAnalysisPath(jobId) {
  return path.join(JOB_ANALYSIS_DIR, `${jobId}.json`);
}

function saveJobAnalysis(jobId, analysis) {
  ensureDir(JOB_ANALYSIS_DIR);
  fs.writeFileSync(jobAnalysisPath(jobId), JSON.stringify(analysis, null, 2), 'utf8');
}

function loadJobAnalysis(jobId) {
  try {
    return JSON.parse(fs.readFileSync(jobAnalysisPath(jobId), 'utf8'));
  } catch {
    return null;
  }
}

function listSavedJobAnalysisIds() {
  if (!fs.existsSync(JOB_ANALYSIS_DIR)) return [];
  return fs.readdirSync(JOB_ANALYSIS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

module.exports = {
  PRIVATE_DATA_DIR,
  JOB_ANALYSIS_DIR,
  saveJobAnalysis,
  loadJobAnalysis,
  listSavedJobAnalysisIds,
};
