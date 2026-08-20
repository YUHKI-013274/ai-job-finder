// Application Packet（応募準備パケット）を非公開のローカルデータとして保存する。
// data/private/ 配下は .gitignore で除外しており、コミット・push・GitHub Pagesには一切含まれない。
// Stage0（job_details）・Stage1（job_analysis）・Stage2（job_ai_analysis）のファイルは一切上書きしない。
const fs = require('fs');
const path = require('path');

const PRIVATE_DATA_DIR = path.join(__dirname, 'data', 'private');
const APPLICATION_PACKETS_DIR = path.join(PRIVATE_DATA_DIR, 'application_packets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function applicationPacketPath(jobId) {
  return path.join(APPLICATION_PACKETS_DIR, `${jobId}.json`);
}

function saveApplicationPacket(jobId, packet) {
  ensureDir(APPLICATION_PACKETS_DIR);
  fs.writeFileSync(applicationPacketPath(jobId), JSON.stringify(packet, null, 2), 'utf8');
}

function loadApplicationPacket(jobId) {
  try {
    return JSON.parse(fs.readFileSync(applicationPacketPath(jobId), 'utf8'));
  } catch {
    return null;
  }
}

function listSavedApplicationPacketIds() {
  if (!fs.existsSync(APPLICATION_PACKETS_DIR)) return [];
  return fs.readdirSync(APPLICATION_PACKETS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

module.exports = {
  PRIVATE_DATA_DIR,
  APPLICATION_PACKETS_DIR,
  saveApplicationPacket,
  loadApplicationPacket,
  listSavedApplicationPacketIds,
};
