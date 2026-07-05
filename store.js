// 既出案件・応募済み案件を data/*.json で永続管理する
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SEEN_PATH = path.join(DATA_DIR, 'seen_jobs.json');
const APPLIED_PATH = path.join(DATA_DIR, 'applied_jobs.json');

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
  loadSeenJobs,
  saveSeenJobs,
  loadAppliedJobs,
  saveAppliedJobs,
  extractJobId,
};
