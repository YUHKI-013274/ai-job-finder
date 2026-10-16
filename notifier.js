const nodemailer = require('nodemailer');
const { loadApplicationPacket } = require('./application-packet-store');
const { loadApplicationDraft } = require('./application-draft-store');
const { buildAnalysisSummary } = require('./application-draft-generator-manual');
const { buildWorkPrompt, buildEntries, writeWorkPromptsPage, WORK_PROMPTS_PAGE_PATH } = require('./work-prompt-builder');

// 案件分析（Application Packet）→ Work依頼用プロンプトを、候補メール本文に直接埋め込む
// （応募文Draftが取り込み済みならそれも表示）。GitHub Pages（公開）には一切載せず、
// 非公開のGmail本文のみに表示することで、個人情報・見積もり事情を含む可能性のある内容を
// 公開ページから切り離す。Packet/Draft/プロンプトのいずれも存在しない場合は何も追加しない
// （存在しない情報を作らない）。
function buildApplicationSectionHtml(job) {
  const jobId = job.id;
  const packet = loadApplicationPacket(jobId);
  if (!packet) return '';

  const s = buildAnalysisSummary(packet);
  const experienceHtml = s.experienceItems.length > 0
    ? s.experienceItems.map(e =>
      `<div style="margin-bottom:6px">・経験: ${escHtml(e.experience)}<br>　根拠: ${escHtml(e.rationale)}<br>　証拠: ${escHtml(e.evidence)}<br>　クライアント価値: ${escHtml(e.clientValue)}</div>`
    ).join('')
    : '（Application Packetに使える経験の記載なし）';

  const analysisHtml = `
    <div style="background:#f7f7fb;border-radius:8px;padding:10px 12px;margin-top:8px;font-size:12px;color:#333">
      <div style="font-weight:bold;margin-bottom:4px">📋 応募判断: ${escHtml(s.judgment)}</div>
      <div><b>クライアントの目的:</b> ${escHtml(s.clientPurpose)}</div>
      <div><b>求められる能力:</b> ${escHtml(s.requiredCapabilities)}</div>
      <div><b>必須条件:</b> ${escHtml(s.requiredConditionsText)}</div>
      <div><b>注意点:</b> ${escHtml(s.cautionText)}</div>
      <div style="margin-top:6px"><b>使用する経験・根拠:</b></div>
      ${experienceHtml}
      <div style="margin-top:6px"><b>応募理由:</b> ${escHtml(s.reasonText)}</div>
    </div>`;

  // Work依頼用プロンプト：メールではJavaScriptが動かないためコピーボタンは置けない。
  // 枠内をクリックで全選択（user-select:all）でき、ボタン付きは添付／ローカルのwork-prompts.htmlで提供する。
  const work = buildWorkPrompt(job, { packet });
  const workHtml = work.ok ? `
    <div style="background:#eef6fb;border:1px solid #bee5f8;border-radius:8px;padding:10px 12px;margin-top:6px;font-size:12px;color:#1a1a1a">
      <div style="font-weight:bold;margin-bottom:4px">📝 Work依頼用プロンプト（ChatGPT Workへ貼る → 完成応募文が返る）</div>
      <div style="font-size:11px;color:#555;margin-bottom:4px">ワンクリックコピーは添付の work-prompts.html の「コピー」ボタンが使えます。メール内ではこの枠をクリックして全選択→コピーしてください。</div>
      <div style="white-space:pre-wrap;font-family:monospace;font-size:11px;background:white;border-radius:6px;padding:8px;max-height:260px;overflow:auto;user-select:all">${escHtml(work.text)}</div>
    </div>` : '';

  const draft = loadApplicationDraft(jobId);
  if (draft && draft.status === 'success') {
    const readyAnswers = (draft.questionAnswers || []).filter(qa => qa.status === 'ready' && qa.answer);
    const answerHtml = readyAnswers.map(qa => `<div style="margin-top:6px"><b>${escHtml(qa.question)}</b><br>${escHtml(qa.answer)}</div>`).join('');
    const confirmItems = (draft.confirmationItems || []).map(c => `・${escHtml(c.item)}（${escHtml(c.reason)}）`).join('<br>');
    return analysisHtml + workHtml + `
    <div style="background:#eefaf0;border:1px solid #bfe8c8;border-radius:8px;padding:10px 12px;margin-top:6px;font-size:12px;color:#1a1a1a">
      <div style="font-weight:bold;margin-bottom:4px">✅ 取り込み済みの応募文</div>
      <div style="white-space:pre-wrap">${escHtml(draft.applicationText)}</div>
      ${answerHtml}
      ${confirmItems ? `<div style="margin-top:8px"><b>確認事項:</b><br>${confirmItems}</div>` : ''}
    </div>`;
  }

  return analysisHtml + workHtml;
}

// 要確認：応募可否や契約条件に関わる重要事項が未確認の案件。確認事項を明示する（全文確認済みのもののみ）。
function buildConfirmSectionHtml(confirmJobs) {
  if (confirmJobs.length === 0) return '';
  const items = confirmJobs.map(j => {
    const bullets = (j.confirmBeforeApply || []).map(c => `<div>・${escHtml(c)}</div>`).join('');
    const shortage = (j.finalClass === '要確認' && j.missingAssets && j.missingAssets.length > 0)
      ? `<div style="margin-top:4px;color:#7a5c00">不足: ${j.missingAssets.map(escHtml).join(' / ')}</div>` : '';
    return `<div style="margin-top:8px"><a href="${j.url}" style="color:#1a1a2e;font-weight:bold;text-decoration:none">${escHtml(j.title)}</a><span style="color:#888"> 💰 ${escHtml(j.price || '要確認')}</span>${bullets}${shortage}</div>`;
  }).join('');
  return `
      <div style="background:#fffbea;border:1px solid #f3dc8a;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#333">
        <div style="font-weight:bold;margin-bottom:2px">❓ 要確認（${confirmJobs.length}件）— 重要事項を確認できれば応募できます</div>
        <div style="font-size:11px;color:#777">確認後に応募する場合のWork依頼用プロンプトは、添付の work-prompts.html にあります。</div>
        ${items}
      </div>`;
}

// 育成候補：戦略に合うが、応募に必要な作品・実績・能力が不足している案件。不足と補う行動を明示する。
function buildGrowthSectionHtml(growthJobs) {
  if (growthJobs.length === 0) return '';
  const items = growthJobs.map(j => {
    const shortage = (j.missingAssets || []).map(m => `<div>不足: ${escHtml(m)}</div>`).join('');
    const actions = (j.growthActions || []).map(a => `<div style="color:#1b6b3a">▶ 補う行動: ${escHtml(a)}</div>`).join('');
    return `<div style="margin-top:8px"><a href="${j.url}" style="color:#1a1a2e;font-weight:bold;text-decoration:none">${escHtml(j.title)}</a><span style="color:#888"> 💰 ${escHtml(j.price || '要確認')}</span>${shortage}${actions}</div>`;
  }).join('');
  return `
      <div style="background:#f0fff4;border:1px solid #bfe8c8;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#333">
        <div style="font-weight:bold;margin-bottom:2px">🌱 育成候補（${growthJobs.length}件）— 不足を補えば応募できる案件</div>
        ${items}
      </div>`;
}

const MAIL_MAX_CONFIRM = 5;
const MAIL_MAX_GROWTH = 5;

async function sendGmailNotification({ jobs, confirmJobs = [], growthJobs = [], stage1Stopped = [], growthCount = 0, pageUrl, date }) {
  const email = process.env.GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!email || !appPassword) {
    console.log('Gmail設定なし（GMAIL_USER / GMAIL_APP_PASSWORD が未設定）');
    return;
  }

  const sCount = jobs.filter(j => j.rank === 'S').length;
  const aCount = jobs.filter(j => j.rank === 'A').length;
  const dateStr = date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' });
  const todayTop = jobs.slice(0, 5);
  const todayRest = jobs.slice(5);
  // 要確認はメールでは全文確認済みのもののみ掲示（詳細未取得の案件はウェブページで確認）
  const confirmShown = confirmJobs.filter(j => !j.unverified).slice(0, MAIL_MAX_CONFIRM);
  const growthShown = growthJobs.filter(j => !j.unverified).slice(0, MAIL_MAX_GROWTH);
  const revenueCount = jobs.filter(j => j.slot === 'revenue').length;

  const todayTopHtml = todayTop.map((job, i) => `
    <tr>
      <td style="padding:10px; border-bottom:1px solid #eee;">
        <span style="background:${getRankColor(job.rank)};color:white;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold">${job.rank}</span>
      </td>
      <td style="padding:10px; border-bottom:1px solid #eee;">
        <a href="${job.url}" style="color:#1a1a2e;font-weight:bold;text-decoration:none">${i + 1}. ${escHtml(job.title)}</a><br>
        <span style="color:#888;font-size:12px">💰 ${escHtml(job.price || '要確認')}</span>${job.slot === 'revenue' ? ' <span style="background:#e8f5e9;color:#1b6b3a;padding:1px 6px;border-radius:8px;font-size:11px">収益・実績枠</span>' : ''}
        ${buildApplicationSectionHtml(job)}
      </td>
    </tr>
  `).join('');

  const todayRestHtml = todayRest.length > 0 ? `
      <div style="font-size:12px;color:#333;margin:-8px 0 16px">
        <div style="font-weight:bold;margin-bottom:2px">ほか今応募 ${todayRest.length}件（Work依頼用プロンプトは添付の work-prompts.html）</div>
        ${todayRest.map(j => `<div>・<a href="${j.url}" style="color:#1a1a2e">${escHtml(j.title)}</a>${j.slot === 'revenue' ? '（収益・実績枠）' : ''}</div>`).join('')}
      </div>` : '';

  // Stage1が見送りと判定した案件は「応募すべき案件」には出さず、理由だけをここで確認できるようにする。
  const stage1StoppedHtml = stage1Stopped.length > 0 ? `
      <div style="background:#fdf2f2;border:1px solid #f5c6c6;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#333">
        <div style="font-weight:bold;margin-bottom:4px">🚫 Stage1判定で見送り（応募候補から除外・${stage1Stopped.length}件）</div>
        ${stage1Stopped.slice(0, 5).map(j => `<div style="margin-top:6px"><a href="${j.url}" style="color:#333">${escHtml(j.title)}</a><br><span style="color:#a33">${escHtml(j.skipReason || '')}</span></div>`).join('')}
        ${stage1Stopped.length > 5 ? `<div style="margin-top:6px;color:#888">ほか${stage1Stopped.length - 5}件（全案件ページで確認できます）</div>` : ''}
      </div>` : '';

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:-apple-system,sans-serif;background:#f0f2f5;margin:0;padding:16px">
  <div style="max-width:500px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#1a1a2e,#0f3460);color:white;padding:20px;border-radius:14px 14px 0 0">
      <h1 style="font-size:18px;margin:0">📋 今日の応募候補</h1>
      <p style="margin:6px 0 0;opacity:0.8;font-size:13px">${dateStr}</p>
    </div>
    <div style="background:white;padding:16px;border-radius:0 0 14px 14px;box-shadow:0 2px 10px rgba(0,0,0,0.08)">
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <span style="background:#fef5f5;color:#e74c3c;border:1px solid #f9a;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold">🔴 S: ${sCount}件</span>
        <span style="background:#fff8f0;color:#e67e22;border:1px solid #fda;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold">🟠 A: ${aCount}件</span>
        <span style="background:#fffbea;color:#a07800;border:1px solid #f3dc8a;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold">❓ 要確認: ${confirmJobs.filter(j => !j.unverified).length}件</span>
        <span style="background:#f0fff4;color:#27ae60;border:1px solid #afa;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold">🌱 育成候補: ${growthJobs.filter(j => !j.unverified).length || growthCount}件</span>
      </div>

      <h2 style="font-size:15px;color:#1a1a2e;margin:0 0 10px">🎯 今応募（${jobs.length}件${revenueCount > 0 ? `／うち収益・実績枠${revenueCount}件` : ''}）</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        ${todayTopHtml || '<tr><td style="padding:10px;color:#888">本日、条件を満たす「今応募」の案件はありません</td></tr>'}
      </table>
      ${todayRestHtml}
      ${buildConfirmSectionHtml(confirmShown)}
      ${buildGrowthSectionHtml(growthShown)}

      ${stage1StoppedHtml}
      <a href="${pageUrl}"
         style="display:block;background:linear-gradient(135deg,#1a1a2e,#0f3460);color:white;text-align:center;padding:14px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">
        📋 全案件を見る →
      </a>

      <p style="text-align:center;color:#aaa;font-size:11px;margin:12px 0 0">
        AI案件獲得システム Ver3.0 | 自動送信
      </p>
    </div>
  </div>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: email, pass: appPassword },
    tls: { rejectUnauthorized: false },
  });

  // コピーボタン付きページ：全候補（最大10件）分を添付し、同じものをPCのローカルにも書き出す
  // （data/private/ は非公開。GitHub Pagesには載せない）。失敗してもメール送信は止めない。
  const attachments = [];
  try {
    const entries = buildEntries([...jobs, ...confirmShown]);
    if (entries.length > 0) {
      const page = writeWorkPromptsPage(entries, { dateLabel: dateStr });
      attachments.push({ filename: 'work-prompts.html', content: page.html, contentType: 'text/html; charset=utf-8' });
      console.log(`Work依頼用プロンプト: ${entries.length}件 → ${WORK_PROMPTS_PAGE_PATH}`);
    }
  } catch (err) {
    console.log(`⚠️  Work依頼用プロンプトページの生成をスキップ: ${err.message}`);
  }

  await transporter.sendMail({
    from: `"AI案件システム" <${email}>`,
    to: email,
    subject: `【今日の応募候補】今応募${jobs.length}件（S${sCount} A${aCount}） 要確認${confirmShown.length}件 育成${growthShown.length}件 ${dateStr}`,
    html,
    attachments,
  });

  console.log(`✅ Gmail通知送信完了 → ${email}`);
}

function getRankColor(rank) {
  return { S: '#e74c3c', A: '#e67e22', B: '#27ae60', C: '#7f8c8d' }[rank] || '#333';
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// システム異常（案件取得そのものが実行できない等）を「今日は良い案件がなかった」とは
// 区別できる件名・本文で通知する。候補メールと同じGmail設定を再利用する。
async function sendSystemAlert({ title, message }) {
  const email = process.env.GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!email || !appPassword) {
    console.log('Gmail設定なし（GMAIL_USER / GMAIL_APP_PASSWORD が未設定）のため異常通知は送信できません');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: email, pass: appPassword },
    tls: { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from: `"AI案件システム" <${email}>`,
    to: email,
    subject: `【要確認】${title}`,
    text: message,
  });

  console.log(`✅ 異常通知メール送信完了 → ${email}`);
}

module.exports = { sendGmailNotification, sendSystemAlert };
