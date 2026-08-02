// 正規Knowledge（Markdown）と構造化キャッシュ（JS）の同期確認。
//
// 正規データは以下のMarkdownである。JSファイル（yuki_profile.js / yuki_common_profile.js /
// yuki_job_dictionary.js）はあくまで構造化キャッシュであり、Markdownが更新されてもJS側は
// 自動追従しない。この不一致を黙って見過ごさないよう、Stage1実行前に必ずハッシュを照合する。
//
// 今回の実装範囲：不一致の検知と処理停止のみ。MarkdownからのJS自動生成は行わない
// （将来の別途実装課題）。
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SALES_KNOWLEDGE_PATH = path.join(__dirname, 'knowledge', 'yuki_sales_knowledge_v1.md');
const COMMON_KNOWLEDGE_PATH = 'C:\\Users\\nagam\\knowledge\\06_common_knowledge\\yuki_common_knowledge.md';

function hashFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// 各JSキャッシュが記録している「転記時点のMarkdownハッシュ」と、現在のMarkdownの実際のハッシュを
// 比較する。読み取れない・ハッシュが記録されていない場合も「不一致」として扱う（安全側）。
function verifyKnowledgeSync() {
  const yukiProfile = require('./knowledge/yuki_profile');
  const yukiCommonProfile = require('./knowledge/yuki_common_profile');
  const yukiJobDictionary = require('./knowledge/yuki_job_dictionary');

  const checks = [
    { cacheName: 'yuki_profile.js', sourcePath: SALES_KNOWLEDGE_PATH, sourceLabel: 'yuki_sales_knowledge_v1.md', recordedHash: yukiProfile.sourceContentHash },
    { cacheName: 'yuki_job_dictionary.js', sourcePath: SALES_KNOWLEDGE_PATH, sourceLabel: 'yuki_sales_knowledge_v1.md', recordedHash: yukiJobDictionary.sourceContentHash },
    { cacheName: 'yuki_common_profile.js', sourcePath: COMMON_KNOWLEDGE_PATH, sourceLabel: 'yuki_common_knowledge.md', recordedHash: yukiCommonProfile.sourceContentHash },
  ];

  const results = checks.map(check => {
    let currentHash = null;
    let readError = null;
    try {
      currentHash = hashFile(check.sourcePath);
    } catch (err) {
      readError = err.message;
    }
    const inSync = !readError && !!check.recordedHash && currentHash === check.recordedHash;
    return {
      cacheName: check.cacheName,
      sourceLabel: check.sourceLabel,
      sourcePath: check.sourcePath,
      recordedHash: check.recordedHash || null,
      currentHash,
      readError,
      inSync,
    };
  });

  const allInSync = results.every(r => r.inSync);
  return { allInSync, results };
}

module.exports = { verifyKnowledgeSync, SALES_KNOWLEDGE_PATH, COMMON_KNOWLEDGE_PATH };
