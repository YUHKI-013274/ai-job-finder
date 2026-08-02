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

// seen_jobs.json（案件履歴）のエントリを最新の評価結果で更新する。
// 「既出」は除外リストではなく履歴として使うため、ここでは各案件の最終確認日・
// 前回/今回の表示区分・最終表示日を記録するだけで、除外判定には一切使わない。
// 応募期限・掲載日・募集状態は、取得できる場合にのみ埋める（取得できない項目は
// 存在しない値として保存し、確認候補側の判断に委ねる。存在しないデータを補完しない）。
function updateJobHistoryEntry(entry, { job, dateLabel, wasShown }) {
  const base = entry || { firstSeen: dateLabel, title: job.title, url: job.url };
  return {
    firstSeen: base.firstSeen || dateLabel,
    title: job.title,
    url: job.url,
    lastChecked: dateLabel,
    postedDate: job.postedDate || base.postedDate || null,
    deadline: job.deadline || base.deadline || null,
    listingStatus: base.listingStatus || 'unknown', // 'unknown'|'open'|'closed'（期限抽出が機能するまでは常にunknown）
    previousTier: base.currentTier || null,
    currentTier: job.displayTier || null,
    lastShownDate: wasShown ? dateLabel : (base.lastShownDate || null),
  };
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
  updateJobHistoryEntry,
};
