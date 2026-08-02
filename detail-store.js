// 案件詳細（本文・クライアント情報・必須回答項目等）を非公開のローカルデータとして保存する。
// data/private/ 配下は .gitignore で除外しており、コミット・push・GitHub Pagesには一切含まれない。
// 案件ごとにjobIdでファイルを分離することで、将来の案件分析・応募文生成へそのまま渡せる形にする。
const fs = require('fs');
const path = require('path');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const JOB_DETAILS_DIR = path.join(PRIVATE_DATA_DIR, 'job_details');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function jobDetailPath(jobId) {
  return path.join(JOB_DETAILS_DIR, `${jobId}.json`);
}

function saveJobDetail(jobId, detail) {
  ensureDir(JOB_DETAILS_DIR);
  fs.writeFileSync(jobDetailPath(jobId), JSON.stringify(detail, null, 2), 'utf8');
}

function saveJobDetails(details) {
  ensureDir(JOB_DETAILS_DIR);
  for (const detail of details) {
    if (!detail.jobId) continue;
    saveJobDetail(detail.jobId, detail);
  }
}

function loadJobDetail(jobId) {
  try {
    return JSON.parse(fs.readFileSync(jobDetailPath(jobId), 'utf8'));
  } catch {
    return null;
  }
}

function listSavedJobDetailIds() {
  if (!fs.existsSync(JOB_DETAILS_DIR)) return [];
  return fs.readdirSync(JOB_DETAILS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

module.exports = {
  PRIVATE_DATA_DIR,
  JOB_DETAILS_DIR,
  saveJobDetail,
  saveJobDetails,
  loadJobDetail,
  listSavedJobDetailIds,
};
