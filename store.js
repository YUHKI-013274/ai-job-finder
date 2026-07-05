// 既出案件・応募済み案件を data/*.json で永続管理する
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SEEN_PATH = path.join(DATA_DIR, 'seen_jobs.json');
const APPLIED_PATH = path.join(DATA_DIR, 'applied_jobs.json');
const JOB_STATUS_PATH = path.join(DATA_DIR, 'job_status.json');

// 案件ステータスの種類（今後「返信あり」「契約済み」「不採用」「保留」等を追加していく前提の一覧）
const JOB_STATUS = {
  SKIPPED: '見送り',
};

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(filePath, obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function loadSeenJobs() {
  return loadJson(SEEN_PATH);
}

function saveSeenJobs(map) {
  saveJson(SEEN_PATH, map);
}

function loadAppliedJobs() {
  return loadJson(APPLIED_PATH);
}

function saveAppliedJobs(map) {
  saveJson(APPLIED_PATH, map);
}

// 案件ステータス（見送り等）を { [jobId]: { status, reason, updatedAt, title, url } } の形で管理。
// 「応募済み」は案件管理シートで別管理しているため、ここでは扱わない。
// 将来的に「返信あり」「契約済み」「不採用」「保留」等のstatusを増やせるよう汎用的に保存する。
function loadJobStatus() {
  return loadJson(JOB_STATUS_PATH);
}

function saveJobStatus(map) {
  saveJson(JOB_STATUS_PATH, map);
}

function setJobStatus(map, jobId, status, extra = {}) {
  map[jobId] = {
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  return map;
}

// 指定ステータスの案件だけを抽出した { [jobId]: {...} } を返す
function filterJobStatus(map, status) {
  const result = {};
  for (const [id, entry] of Object.entries(map)) {
    if (entry.status === status) result[id] = entry;
  }
  return result;
}

// クラウドワークスのURLまたは素の数字IDから案件IDを取り出す
function extractJobId(idOrUrl) {
  const str = String(idOrUrl).trim();
  const m = str.match(/\/public\/jobs\/(\d+)/) || str.match(/^(\d+)$/);
  return m ? m[1] : null;
}

module.exports = {
  DATA_DIR,
  SEEN_PATH,
  APPLIED_PATH,
  JOB_STATUS_PATH,
  JOB_STATUS,
  loadSeenJobs,
  saveSeenJobs,
  loadAppliedJobs,
  saveAppliedJobs,
  loadJobStatus,
  saveJobStatus,
  setJobStatus,
  filterJobStatus,
  extractJobId,
};
