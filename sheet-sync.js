// 案件管理シート（Googleスプレッドシート）のC列（案件URL）を読み取り、
// 応募済みリスト data/applied_jobs.json に自動同期する。
// シートは「リンクを知っている全員が閲覧者」で共有されている必要がある。
const https = require('https');
const { loadAppliedJobs, saveAppliedJobs, extractJobId } = require('./store');

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        fetchText(res.headers.location, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseUrlColumnCsv(csvText) {
  return csvText
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^"|"$/g, ''))
    .filter(line => /crowdworks\.jp\/public\/jobs\/\d+/.test(line));
}

// sheetUrl: シートの通常URL（.../edit?gid=0#gid=0）または gvizのCSV URLどちらでも可
function toGvizUrl(sheetUrl) {
  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!idMatch) return sheetUrl; // すでにgviz/CSV形式などの場合はそのまま使う
  const gidMatch = sheetUrl.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/gviz/tq?tqx=out:csv&gid=${gid}&tq=SELECT%20C`;
}

async function syncAppliedFromSheet(sheetUrl) {
  if (!sheetUrl) return { synced: 0, skipped: true };

  const csvUrl = toGvizUrl(sheetUrl);
  let csvText;
  try {
    csvText = await fetchText(csvUrl);
  } catch (err) {
    console.log(`⚠️  案件管理シートの取得に失敗しました: ${err.message}（共有設定を確認してください）`);
    return { synced: 0, error: err.message };
  }

  const urls = parseUrlColumnCsv(csvText);
  const applied = loadAppliedJobs();
  const now = new Date().toISOString();
  let addedCount = 0;

  for (const url of urls) {
    const id = extractJobId(url);
    if (!id || applied[id]) continue;
    applied[id] = { appliedAt: now, source: 'sheet', sheetUrl: url };
    addedCount++;
  }

  if (addedCount > 0) saveAppliedJobs(applied);
  return { synced: addedCount, total: urls.length };
}

module.exports = { syncAppliedFromSheet, parseUrlColumnCsv, toGvizUrl };
