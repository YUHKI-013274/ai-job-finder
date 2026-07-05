// 応募済み案件を data/applied_jobs.json に登録するCLI
// 使い方: node mark-applied.js <案件IDまたはURL> [<ID2> ...]
const { loadAppliedJobs, saveAppliedJobs, extractJobId } = require('./store');

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('使い方: node mark-applied.js <案件IDまたはURL> [<ID2> ...]');
    console.log('例: node mark-applied.js 12345678 https://crowdworks.jp/public/jobs/87654321');
    process.exit(1);
  }

  const applied = loadAppliedJobs();
  const now = new Date().toISOString();
  let addedCount = 0;

  for (const arg of args) {
    const id = extractJobId(arg);
    if (!id) {
      console.log(`⚠️  IDを認識できませんでした: ${arg}`);
      continue;
    }
    if (applied[id]) {
      console.log(`- ${id} はすでに応募済み登録済みです`);
      continue;
    }
    applied[id] = { appliedAt: now, source: arg };
    addedCount++;
    console.log(`✅ ${id} を応募済みとして登録しました`);
  }

  saveAppliedJobs(applied);
  console.log(`\n完了: ${addedCount}件を新規登録（合計 ${Object.keys(applied).length}件）`);
}

main();
