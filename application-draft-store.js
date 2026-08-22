// 応募文・応募時回答ドラフト（Application Draft）を非公開のローカルデータとして保存する。
// data/private/ 配下は .gitignore で除外しており、コミット・push・GitHub Pagesには一切含まれない。
// Application Packet（data/private/application_packets/）のファイル自体は一切上書きしない。
const fs = require('fs');
const path = require('path');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const APPLICATION_DRAFTS_DIR = path.join(PRIVATE_DATA_DIR, 'application_drafts');
const APPLICATION_DRAFTS_FAILED_DIR = path.join(PRIVATE_DATA_DIR, 'application_drafts_failed');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function applicationDraftPath(jobId) {
  return path.join(APPLICATION_DRAFTS_DIR, `${jobId}.json`);
}

function saveApplicationDraft(jobId, draft) {
  ensureDir(APPLICATION_DRAFTS_DIR);
  fs.writeFileSync(applicationDraftPath(jobId), JSON.stringify(draft, null, 2), 'utf8');
}

function loadApplicationDraft(jobId) {
  try {
    return JSON.parse(fs.readFileSync(applicationDraftPath(jobId), 'utf8'));
  } catch {
    return null;
  }
}

function listSavedApplicationDraftIds() {
  if (!fs.existsSync(APPLICATION_DRAFTS_DIR)) return [];
  return fs.readdirSync(APPLICATION_DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

// 失敗記録は同一jobIdで複数回試行しても上書きされないよう、試行時刻をファイル名に含める。
// 成功済みドラフト（application_drafts/{jobId}.json）は失敗時に一切触れない
// （既存の良いドラフトを壊さない・捏造した内容を正式ファイルへ保存しない）。
function saveFailedDraftAttempt(jobId, failureRecord) {
  ensureDir(APPLICATION_DRAFTS_FAILED_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(APPLICATION_DRAFTS_FAILED_DIR, `${jobId}_${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(failureRecord, null, 2), 'utf8');
  return filePath;
}

module.exports = {
  PRIVATE_DATA_DIR,
  APPLICATION_DRAFTS_DIR,
  APPLICATION_DRAFTS_FAILED_DIR,
  saveApplicationDraft,
  loadApplicationDraft,
  listSavedApplicationDraftIds,
  saveFailedDraftAttempt,
};
