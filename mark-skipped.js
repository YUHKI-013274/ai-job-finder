// 見送り（応募しないと判断した）案件を data/job_status.json に登録するCLI
// 使い方: node mark-skipped.js "<案件IDまたはURL>[|見送り理由]" [...]
// URLに ":" が含まれるため、ID/URLと理由の区切りには "|" を使う。
// 例: node mark-skipped.js "12345678|単価が低い" "https://crowdworks.jp/public/jobs/87654321|条件が合わない"
const { loadJobStatus, saveJobStatus, setJobStatus, extractJobId, JOB_STATUS } = require('./store');

function parseArg(arg) {
  const sepIndex = arg.indexOf('|');
  if (sepIndex === -1) return { idOrUrl: arg, reason: '理由未記入' };
  const reason = arg.slice(sepIndex + 1).trim();
  return { idOrUrl: arg.slice(0, sepIndex), reason: reason || '理由未記入' };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('使い方: node mark-skipped.js "<案件IDまたはURL>[|見送り理由]" [...]');
    console.log('例: node mark-skipped.js "12345678|単価が低い" "https://crowdworks.jp/public/jobs/87654321|条件が合わない"');
    process.exit(1);
  }

  const statusMap = loadJobStatus();
  let addedCount = 0;

  for (const arg of args) {
    const { idOrUrl, reason } = parseArg(arg);
    const id = extractJobId(idOrUrl);
    if (!id) {
      console.log(`⚠️  IDを認識できませんでした: ${arg}`);
      continue;
    }
    setJobStatus(statusMap, id, JOB_STATUS.SKIPPED, { reason, source: idOrUrl });
    addedCount++;
    console.log(`✅ ${id} を見送りとして登録しました（理由: ${reason}）`);
  }

  saveJobStatus(statusMap);
  console.log(`\n完了: ${addedCount}件を登録`);
}

main();
