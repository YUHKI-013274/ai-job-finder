const nodemailer = require('nodemailer');

async function sendGmailNotification({ jobs, growthCount = 0, pageUrl, date }) {
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

  const todayTopHtml = todayTop.map((job, i) => `
    <tr>
      <td style="padding:10px; border-bottom:1px solid #eee;">
        <span style="background:${getRankColor(job.rank)};color:white;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold">${job.rank}</span>
      </td>
      <td style="padding:10px; border-bottom:1px solid #eee;">
        <a href="${job.url}" style="color:#1a1a2e;font-weight:bold;text-decoration:none">${i + 1}. ${escHtml(job.title)}</a><br>
        <span style="color:#888;font-size:12px">💰 ${escHtml(job.price || '要確認')}</span>
      </td>
    </tr>
  `).join('');

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
        <span style="background:#f0fff4;color:#27ae60;border:1px solid #afa;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold">🌱 成長候補: ${growthCount}件</span>
      </div>

      <h2 style="font-size:15px;color:#1a1a2e;margin:0 0 10px">🎯 今日応募すべき案件（S・A、最大5件）</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        ${todayTopHtml || '<tr><td style="padding:10px;color:#888">本日はS・Aランクの応募候補がありません</td></tr>'}
      </table>

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

  await transporter.sendMail({
    from: `"AI案件システム" <${email}>`,
    to: email,
    subject: `【今日の応募候補】S${sCount}件 A${aCount}件 ${dateStr}`,
    html,
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
