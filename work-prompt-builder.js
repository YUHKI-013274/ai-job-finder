// 「Work依頼用プロンプト」の組み立てとコピー用ページの生成。
// 既に取得・確定済みの案件分析（Application Packet）と案件オブジェクトの事実を並べるだけで、
// 新しい判断・推測・AI呼び出しは一切行わない（Packetに無い情報は「（未記載）」と表示する）。
//
// 使い方（ゆうきの運用）:
//   候補メール（または data/private/work_prompts/index.html）で案件を確認
//   → 「コピー」でWork依頼用プロンプトをコピー → ChatGPT Workへ貼る → 完成応募文をCrowdWorksへ貼る
const fs = require('fs');
const path = require('path');
const { loadApplicationPacket } = require('./application-packet-store');
const { buildAnalysisSummary } = require('./application-draft-generator-manual');

const WORK_PROMPTS_DIR = path.join(__dirname, 'data', 'private', 'work_prompts');
const WORK_PROMPTS_PAGE_PATH = path.join(WORK_PROMPTS_DIR, 'index.html');

const WORK_INSTRUCTION = `上記情報をもとに、この案件の受注可能性を高めるCrowdWorks応募文を作成してください。
目的は、ゆうき固有の経験を「この人を採用する理由」に変換し、クライアントが「この人なら任せられる」「自分たちの案件にどう貢献できるか分かる」と判断できる営業文にすることです。

【書く前の内部処理（出力しない）】
STEP1 案件情報から、採用側が重視している能力・条件・求める成果を確認する。
STEP2 【ゆうきが使える経験】から、今回使える確認済みの経験・職能を3〜5個抽出する。
STEP3 その中から「今回の案件へ直接使えて、他の応募者が同時に持ちにくい組み合わせ」を選ぶ。採用理由は原則として2つ以上の経験・職能の組み合わせで作る。単独の経験（飲食業22年／ChatGPTを使える／丁寧／納期厳守／ツール操作 など）だけを採用理由にしない。
STEP4 選んだ組み合わせを「本人の経験 → 今回できること → クライアントが得られる価値」に変換し、これを「採用する理由」として1つに固定する。

【応募文のルール】
1. 冒頭1〜2文：固定した採用理由（本人固有の経験・職能／今回どう使えるか／クライアントが得られる価値）を簡潔に伝える。単なる自己紹介、案件への共感、「学びたい」「経験を積みたい」「未経験ですが」から始めない。
2. 本文：案件に必要なものだけを書く。活かせる経験は最大3軸。各軸は「経験・スキル → 根拠となる事実 → 今回どう使うか → クライアントへの価値」で書き、経歴紹介で終わらせない。冒頭の採用理由と本文の営業軸を変えない。
3. 重複禁止：同じ事実を冒頭・経歴・実績・スキル・稼働・締めで繰り返さない。1つの事実は最も効果的な場所で1回だけ使う。一般的な制作工程や案件内容の長い言い換えは書かない。
4. 文字数：クライアントの指定を最優先する。指定がなければ、簡易案件は500〜700字、継続・専門案件は700〜900字を基本、指定質問が多い案件のみ最大1,100字程度。超えそうなら重複・経歴説明・案件理解の説明から削る。文章量で営業力を補わない。
5. 未経験の扱い：事実は隠さないが、直接実績がないことを主役にしない。既存経験で代替証明できる場合は、「未経験」ではなく「既存のどの能力を今回どう転用できるか」を主役にする。自主制作と外部受注実績は必ず区別する。
6. 事実厳守：上記に存在しない経験・成果・実績・数値は書かない。【注意点】の主張禁止・使わない表現は使わない。
7. ポートフォリオ：【ポートフォリオ】のうち、案件との関連性が最も高いものを最大1URLだけ自然に入れる。関連性が薄ければ入れない。「未設定」の場合はURLを書かない。
8. 不明情報：案件で必須回答とされているのに確認済み情報がない場合のみ［要記入：○○］とする。推測で埋めない。必須でない情報は、不足していても応募文へ追加しない。

【出力前ゲート（内部確認・出力しない）】次のいずれかに該当すれば、修正してから出力する。
・採用理由が1つに定まっていない／2つ以上の経験・職能を組み合わせられる案件なのに単一経験だけになっている
・他の応募者にもそのまま使える内容／クライアントが「この人を採用する理由」を判断できない
・冒頭と本文で営業軸が違う
・飲食業22年やAIツール名だけが目立つ
・経歴や実績を重複している／一般的な制作工程を書いている／必要以上に長い
・未経験であることが主役になっている
・事実にない経験、成果、実績が入っている

出力は、そのままCrowdWorksへ貼れる完成応募文のみ。
分析、採用理由の内部検討、解説、評価、注意書き、JSONは出力しない。`;

const NOT_RECORDED = '（未記載）';

// ポートフォリオURL台帳（knowledge/yuki_portfolio.js）から、資産名に一致するURLを返す（無ければnull）。
function resolvePortfolioUrl(assetName) {
  const { portfolios } = require('./knowledge/yuki_portfolio');
  const hit = portfolios.find(p => p.matchAssetNameIncludes.some(k => String(assetName || '').includes(k)));
  return hit ? hit.url : null;
}

function formatPrice(price) {
  if (!price) return NOT_RECORDED;
  if (typeof price === 'string') return price;
  return [price.type, price.raw].filter(Boolean).join(' ') || NOT_RECORDED;
}

function formatDeadline(deadline) {
  if (!deadline) return NOT_RECORDED;
  if (typeof deadline === 'string') return deadline;
  return deadline.raw || deadline.normalized || NOT_RECORDED;
}

function uniqueExperiences(items) {
  const seen = new Set();
  const result = [];
  for (const e of items) {
    const key = `${e.experience}|${e.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}

// job: 候補メールで使う案件オブジェクト（id・title・url・rank・strengthHint等。strengthHintは無くても可）
// 戻り値: { ok: true, text } | { ok: false, reason }
function buildWorkPrompt(job, { packet } = {}) {
  const jobId = String(job.id || job.jobId);
  const p = packet || loadApplicationPacket(jobId);
  if (!p) {
    return { ok: false, reason: `Application Packet（${jobId}）が未生成のため、Work依頼用プロンプトを作れません` };
  }

  const s = buildAnalysisSummary(p);
  const pj = p.job || {};
  const title = job.title || pj.title || NOT_RECORDED;
  const url = job.url || pj.url || `https://crowdworks.jp/public/jobs/${jobId}`;
  const rankText = job.rank || (p.evaluation && p.evaluation.rank) || '';

  const capabilityText = s.requiredCapabilities;

  const cautionLines = [];
  if (s.cautionText && s.cautionText !== '特になし') cautionLines.push(`・${s.cautionText}`);
  const facts = p.usableFactsForProposal || {};
  (facts.prohibitedClaims || []).forEach(c => cautionLines.push(`・主張禁止: ${c}`));
  if ((facts.avoidExpressions || []).length > 0) {
    cautionLines.push(`・使わない表現: ${facts.avoidExpressions.join(' / ')}`);
  }
  const cautionText = cautionLines.length > 0 ? cautionLines.join('\n') : '特になし';

  const missingText = s.confirmationItems.length > 0
    ? s.confirmationItems.map(m => `・${m.item}（${m.reason}）`).join('\n')
    : 'なし';

  const experienceItems = uniqueExperiences(s.experienceItems);
  const experienceText = experienceItems.length > 0
    ? experienceItems.map(e =>
      `・経験: ${e.experience}\n  根拠: ${e.rationale}\n  証拠レベル: ${e.evidence}\n  クライアントへの価値: ${e.clientValue}`
    ).join('\n\n')
    : '（Application Packetに使える経験の記載なし。事実のない経験は書かないでください）';

  const portfolioNotes = (facts.portfolioCandidates || [])
    .filter(c => c.caution)
    .map(c => `・${c.assetName}: ${c.caution}`);
  const portfolioText = portfolioNotes.length > 0 ? `\n\n【使用時の注意（実績の扱い）】\n${portfolioNotes.join('\n')}` : '';

  const portfolioUrlLines = (facts.portfolioCandidates || []).map(c =>
    `・${c.assetName}${c.recommendationLevel ? `（関連度: ${c.recommendationLevel}）` : ''}: ${c.url || resolvePortfolioUrl(c.assetName) || 'URL未設定（本文にURLを書かない）'}`);
  const portfolioUrlText = portfolioUrlLines.length > 0 ? portfolioUrlLines.join('\n') : 'なし（本文にURLを書かない）';

  const axisLines = [];
  if (job.strengthHint) axisLines.push(job.strengthHint);
  if (facts.centralMessage) axisLines.push(`中心メッセージ: ${facts.centralMessage}`);
  const axisText = axisLines.length > 0 ? axisLines.join('\n') : NOT_RECORDED;

  const conditionLines = [];
  const aq = p.applicationQuestions || {};
  if (aq.requiredConditions && aq.requiredConditions.value) conditionLines.push(`・必須条件: ${aq.requiredConditions.value}`);
  if (aq.responseItems && aq.responseItems.value) conditionLines.push(`・応募時に書くよう求められている事項: ${aq.responseItems.value}`);
  // 案件全文から検出した重要事項（Stage1：application-conditions.js）
  const sig = p.selectionSignals;
  if (sig) {
    if (sig.age && sig.age.level === 'hard') conditionLines.push(`・年齢条件: ${sig.age.excerpt}（本人が該当するか確認が必要。応募文では年齢を断定しない）`);
    if (sig.qualification && sig.qualification.detected) conditionLines.push(`・応募資格の限定: ${sig.qualification.excerpt}`);
    if (sig.requiredExperience && sig.requiredExperience.detected) conditionLines.push(`・必須の経験: ${sig.requiredExperience.excerpt}（登録済みの経験・作品で述べられる範囲のみ。無い経験は書かない）`);
    if (sig.workConstraint && sig.workConstraint.detected) conditionLines.push(`・稼働条件: ${sig.workConstraint.excerpts.join(' / ')}（対応可否は本人確認。創作せず、必要なら［要記入：○○］）`);
    if (sig.specialApply && sig.specialApply.detected) conditionLines.push(`・特殊な応募方式: ${sig.specialApply.excerpts.join(' / ')}（応募画面での入力は本人が行う。応募文には書かない）`);
    if (sig.requiredSubmission && sig.requiredSubmission.required) {
      conditionLines.push(`・必須の提出物: ${sig.requiredSubmission.excerpt}${sig.requiredSubmission.uncovered.length > 0 ? `（同種の登録作品なし：${sig.requiredSubmission.uncovered.map(u => u.label).join('・')}）` : ''}`);
    }
  }
  if (conditionLines.length === 0) {
    conditionLines.push('・自動抽出なし。上記【案件内容】の「応募資格」「応募方法」「選考」等の記載に従ってください');
  }

  const text = [
    `【案件名】\n${title}`,
    `【案件URL / Job ID】\n${url}\nJob ID: ${jobId}`,
    `【報酬・締切】\n報酬: ${formatPrice(pj.price || job.price)} / 締切: ${formatDeadline(pj.deadline || job.deadline)}`,
    `【応募判断】\n${s.judgment}${rankText ? `（ランク${rankText}）` : ''}\n理由: ${s.reasonText}`,
    `【案件分析】\nクライアントの目的: ${s.clientPurpose}`,
    `【案件内容】\n${pj.description || NOT_RECORDED}`,
    `【求められる能力】\n${capabilityText}`,
    `【注意点】\n${cautionText}`,
    `【不足しているもの（確認できていない情報）】\n${missingText}`,
    `【ゆうきが使える経験・根拠・証拠レベル】\n${experienceText}${portfolioText}`,
    `【ポートフォリオ】\n${portfolioUrlText}`,
    `【提案文の軸】\n${axisText}`,
    `【応募時に確認すべき条件】\n${conditionLines.join('\n')}`,
    `【Workへの指示】\n${WORK_INSTRUCTION}`,
  ].join('\n\n');

  return { ok: true, jobId, title, text };
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// コピーボタン付きページ（JavaScriptを使うため、メールの添付またはローカルファイルとしてブラウザで開く）。
function buildWorkPromptsPageHtml(entries, { dateLabel = '' } = {}) {
  const cards = entries.map((e, i) => `
  <section class="card">
    <h2>${i + 1}. ${esc(e.title)}</h2>
    <div class="meta">${e.cls ? `<b>${esc(e.cls)}${e.slot === 'revenue' ? '（収益・実績枠）' : ''}</b> ／ ` : ''}${e.rank ? `ランク${esc(e.rank)} ／ ` : ''}Job ID: ${esc(e.jobId)} ／ <a href="${esc(e.url)}" target="_blank" rel="noopener">案件ページ</a></div>
    <button class="copy" data-target="p${i}">📋 Work依頼用プロンプトをコピー</button>
    <span class="done" id="done-p${i}"></span>
    <textarea id="p${i}" readonly rows="8">${esc(e.text)}</textarea>
  </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work依頼用プロンプト ${esc(dateLabel)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; background:#f0f2f5; margin:0; padding:16px; color:#1a1a2e; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { font-size:18px; margin:0 0 4px; }
  .lead { font-size:13px; color:#555; margin:0 0 16px; }
  .card { background:#fff; border-radius:12px; padding:14px; margin-bottom:14px; box-shadow:0 1px 6px rgba(0,0,0,.08); }
  .card h2 { font-size:15px; margin:0 0 6px; }
  .meta { font-size:12px; color:#777; margin-bottom:10px; }
  button.copy { background:#0f3460; color:#fff; border:0; border-radius:8px; padding:10px 16px; font-size:14px; font-weight:bold; cursor:pointer; }
  button.copy:active { opacity:.8; }
  .done { margin-left:10px; font-size:13px; color:#27ae60; font-weight:bold; }
  textarea { width:100%; box-sizing:border-box; margin-top:10px; font-size:12px; font-family:monospace; border:1px solid #ddd; border-radius:8px; padding:8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📋 Work依頼用プロンプト ${esc(dateLabel)}</h1>
  <p class="lead">案件を確認 → 「コピー」→ ChatGPT Workへ貼る → 返ってきた完成応募文をCrowdWorksへ貼る。</p>
${cards}
</div>
<script>
  document.querySelectorAll('button.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var ta = document.getElementById(btn.dataset.target);
      var done = document.getElementById('done-' + btn.dataset.target);
      function ok() { done.textContent = '✅ コピーしました'; setTimeout(function () { done.textContent = ''; }, 3000); }
      function fallback() { ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { done.textContent = '⚠️ 手動でコピーしてください（枠内を全選択）'; } }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(ok, fallback);
      } else { fallback(); }
    });
  });
</script>
</body>
</html>`;
}

// jobs（候補メールの案件オブジェクト配列）からエントリを作る。Packet未生成の案件は含めない。
function buildEntries(jobs) {
  const entries = [];
  for (const job of jobs) {
    const r = buildWorkPrompt(job);
    if (!r.ok) continue;
    entries.push({
      jobId: r.jobId,
      title: r.title,
      rank: job.rank || '',
      cls: job.finalClass || '',
      slot: job.slot || null,
      url: job.url || `https://crowdworks.jp/public/jobs/${r.jobId}`,
      text: r.text,
    });
  }
  return entries;
}

function writeWorkPromptsPage(entries, options = {}) {
  fs.mkdirSync(WORK_PROMPTS_DIR, { recursive: true });
  const html = buildWorkPromptsPageHtml(entries, options);
  fs.writeFileSync(WORK_PROMPTS_PAGE_PATH, html, 'utf8');
  return { filePath: WORK_PROMPTS_PAGE_PATH, html };
}

module.exports = {
  WORK_PROMPTS_PAGE_PATH,
  WORK_INSTRUCTION,
  buildWorkPrompt,
  buildEntries,
  buildWorkPromptsPageHtml,
  writeWorkPromptsPage,
};

// CLI: node work-prompt-builder.js <jobId>  … Work依頼用プロンプトを表示してクリップボードへコピー
if (require.main === module) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.log('使い方: node work-prompt-builder.js <jobId>');
    process.exit(1);
  }
  const r = buildWorkPrompt({ id: jobId });
  if (!r.ok) {
    console.error(`❌ ${r.reason}`);
    process.exit(1);
  }
  const { writeClipboardText } = require('./application-draft-generator-manual');
  const clip = writeClipboardText(r.text);
  console.log(r.text);
  console.log(clip.ok ? '\n📋 Work依頼用プロンプトをクリップボードにコピーしました' : `\n⚠️  ${clip.reason}`);
}
