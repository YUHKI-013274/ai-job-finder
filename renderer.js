const { toStars } = require('./evaluator');

function getRankColor(rank) {
  return { S: '#e74c3c', A: '#e67e22', B: '#27ae60', C: '#7f8c8d' }[rank] || '#333';
}

function getRankBg(rank) {
  return { S: '#fef5f5', A: '#fff8f0', B: '#f0fff4', C: '#f5f5f5' }[rank] || '#fff';
}

function getReasonColor(reason) {
  return {
    '応募済み': '#27ae60',
    '見送り': '#34495e',
    '既出': '#7f8c8d',
    '単価が低すぎる': '#e67e22',
    '条件不一致': '#8e44ad',
    '条件不一致（属性）': '#8e44ad',
    'SNS運用代行': '#16a085',
    'リスクあり': '#e74c3c',
    '必須条件不一致（資格・専門実務）': '#8e44ad',
    '必須条件不一致（指定ツール）': '#8e44ad',
    '対応不可（Knowledge判定）': '#c0392b',
  }[reason] || '#555';
}

function getCapabilityColor(status) {
  return { '応募可能': '#27ae60', 'チャレンジ可能': '#2980b9', '確認候補': '#8e44ad' }[status] || '#7f8c8d';
}

function getTierBadge(displayTier) {
  if (displayTier === 'now_pending') return { text: '⏳ 条件確認後に応募', bg: '#e0e0e0', color: '#555' };
  if (displayTier === 'high_value_challenge') return { text: '🔥 高単価チャレンジ', bg: '#d35400', color: '#fff' };
  if (displayTier === 'normal_challenge') return { text: '🌱 通常チャレンジ', bg: '#27ae60', color: '#fff' };
  if (displayTier === 'confirm_candidate') return { text: '❓ 確認候補', bg: '#8e44ad', color: '#fff' };
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderJobCard(job, i, isTop3 = false) {
  const rankColor = getRankColor(job.rank);
  const rankBg = getRankBg(job.rank);
  const tierBadge = getTierBadge(job.displayTier);

  return `
    <div class="job-card rank-${job.rank.toLowerCase()}${isTop3 ? ' top3-card' : ''}"
         data-id="${job.id}"
         style="border-left-color:${rankColor}; background:${rankBg}">

      <div class="job-header">
        <span class="job-number" style="background:${rankColor}">${i + 1}</span>
        <span class="rank-badge" style="background:${rankColor}">${job.rank}ランク</span>
        ${isTop3 ? '<span class="top3-badge">🎯 今日応募すべき案件</span>' : ''}
        ${tierBadge ? `<span class="tier-badge" style="background:${tierBadge.bg}; color:${tierBadge.color}">${tierBadge.text}</span>` : ''}
        ${job.priceUnverified ? '<span class="promoted-badge">💰 金額確認待ち</span>' : ''}
        ${job.capabilityStatus ? `<span class="capability-badge" style="background:${getCapabilityColor(job.capabilityStatus)}">${escapeHtml(job.capabilityStatus)}</span>` : ''}
        <span class="genre-tag">${escapeHtml(job.genre)}</span>
      </div>

      <h2 class="job-title">
        <a href="${job.url}" target="_blank" rel="noopener">${escapeHtml(job.title)}</a>
      </h2>

      <div class="job-meta">
        <span class="meta-item">💰 ${escapeHtml(job.price || '要確認')}</span>
        ${job.applicants != null ? `<span class="meta-item">👥 ${job.applicants}人</span>` : ''}
        ${job.deadline ? `<span class="meta-item">📅 ${escapeHtml(job.deadline)}</span>` : ''}
        <span class="meta-item keyword-tag">🔑 ${escapeHtml(job.matchedKeyword)}</span>
      </div>

      <div class="scores">
        <div class="score-row">
          <span class="score-label">②職能一致度</span>
          <span class="score-stars">${toStars(job.categoryScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">①証拠の強さ（ポートフォリオ活用度）</span>
          <span class="score-stars">${toStars(job.portfolioActivationScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">⑥単価</span>
          <span class="score-stars">${toStars(job.priceScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">⑤継続性</span>
          <span class="score-stars">${toStars(job.continuityScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">⑧長期資産性</span>
          <span class="score-stars">${toStars(job.longTermAssetScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">④受注できる可能性</span>
          <span class="score-stars">${toStars(job.winScore)}</span>
        </div>
      </div>

      <div class="detail-section reason">
        <div class="detail-label">✅ この案件を選ぶ理由（証拠の強さ: ${escapeHtml(job.evidenceStrength || '-')}）</div>
        <div class="signal-chips">
          ${(job.matchedSignals && job.matchedSignals.length > 0)
            ? job.matchedSignals.map(s => `<span class="signal-chip">${toStars(s.stars)} ${escapeHtml(s.label)}</span>`).join('')
            : `<span class="detail-text">${escapeHtml(job.reason)}</span>`}
        </div>
        ${job.capabilityReason ? `
        <div class="detail-text" style="margin-top:6px">🧭 ${escapeHtml(job.capabilityReason)}</div>
        ${job.matchedCapabilities && job.matchedCapabilities.length > 0 ? `<div class="detail-text" style="margin-top:2px">使用できる能力: ${job.matchedCapabilities.map(escapeHtml).join('・')}</div>` : ''}
        ${job.decisionSource ? `<div class="decision-source">判定根拠: ${escapeHtml(job.decisionSource)}</div>` : ''}` : ''}
      </div>

      ${(job.displayTier === 'high_value_challenge' && job.highValueSignals && job.highValueSignals.length > 0) ? `
      <div class="detail-section highvalue">
        <div class="detail-label">🔥 高単価チャレンジと判断した理由</div>
        <div class="detail-text">${job.highValueSignals.map(s => escapeHtml(s.text)).join('、')}</div>
      </div>` : ''}

      ${(job.confirmBeforeApply && job.confirmBeforeApply.length > 0) ? `
      <div class="detail-section confirm">
        <div class="detail-label">☑️ 応募前に確認すべき条件</div>
        <div class="detail-text">${job.confirmBeforeApply.map(escapeHtml).join('、')}</div>
      </div>` : ''}

      <div class="detail-section strength">
        <div class="detail-label">💡 提案文の軸</div>
        <div class="detail-text" style="white-space:pre-line">${escapeHtml(job.strengthHint)}</div>
      </div>

      ${(job.missingAssets && job.missingAssets.length > 0) ? `
      <div class="detail-section missing">
        <div class="detail-label">🧩 不足しているもの</div>
        <div class="detail-text">${job.missingAssets.map(escapeHtml).join('、')}</div>
      </div>` : ''}

      <div class="detail-section caution">
        <div class="detail-label">⚠️ 注意点</div>
        <div class="detail-text">${escapeHtml(job.caution)}</div>
      </div>

      <span class="applied-overlay">✅ 応募済み</span>
      <span class="skipped-overlay">⏭ 見送り</span>
      <div class="card-actions">
        <a href="${job.url}" target="_blank" class="btn-view">案件を見る →</a>
        <button class="btn-save" onclick="toggleSave('${job.id}', '${escapeHtml(job.title.replace(/'/g, ''))}', '${job.url}', '${job.rank}')">
          <span class="save-icon">🔖</span> <span class="save-text">候補に追加</span>
        </button>
        <button class="btn-applied" onclick="toggleApplied('${job.id}', '${escapeHtml(job.title.replace(/'/g, ''))}', '${job.url}')">
          <span class="applied-text">✅ 応募済み</span>
        </button>
        <button class="btn-skip" onclick="toggleSkip('${job.id}', '${escapeHtml(job.title.replace(/'/g, ''))}', '${job.url}')">
          <span class="skip-text">⏭ 見送り</span>
        </button>
      </div>
    </div>
  `;
}

function renderExcludedCard(job) {
  const color = getReasonColor(job.excludeReason);
  return `
    <div class="excluded-card" data-reason="${escapeHtml(job.excludeReason)}">
      <div class="excluded-header">
        <span class="reason-badge" style="background:${color}">${escapeHtml(job.excludeReason)}</span>
        <span class="genre-tag">${escapeHtml(job.genre || job.matchedKeyword || '')}</span>
      </div>
      <div class="excluded-title">
        <a href="${job.url}" target="_blank" rel="noopener">${escapeHtml(job.title)}</a>
      </div>
      <div class="job-meta">
        <span class="meta-item">💰 ${escapeHtml(job.price || '要確認')}</span>
      </div>
      ${job.skipReason ? `<div class="skip-reason-text">見送り理由: ${escapeHtml(job.skipReason)}</div>` : ''}
      ${job.capabilityReason ? `<div class="skip-reason-text">🧭 ${escapeHtml(job.capabilityReason)}${job.decisionSource ? `（判定根拠: ${escapeHtml(job.decisionSource)}）` : ''}</div>` : ''}
    </div>
  `;
}

function renderRankSections(jobs, startIndex) {
  let html = '';
  let counter = startIndex;
  const sections = [
    { label: 'Sランク', list: jobs.filter(j => j.rank === 'S'), color: '#e74c3c' },
    { label: 'Aランク', list: jobs.filter(j => j.rank === 'A'), color: '#e67e22' },
    { label: 'Bランク', list: jobs.filter(j => j.rank === 'B'), color: '#27ae60' },
    { label: 'Cランク', list: jobs.filter(j => j.rank === 'C'), color: '#7f8c8d' },
  ];
  for (const sec of sections) {
    if (sec.list.length === 0) continue;
    html += `<div class="rank-section-header" style="border-left:4px solid ${sec.color}">
      <span style="color:${sec.color}">${sec.label}</span>
      <span class="count-badge" style="background:${sec.color}">${sec.list.length}件</span>
    </div>`;
    for (const job of sec.list) {
      html += renderJobCard(job, counter++);
    }
  }
  return html;
}

function renderHTML({ nowApply, highValueChallenge = [], normalChallenge = [], confirmCandidates = [], holds, excluded }, date, pageUrl) {
  const dateStr = date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const sJobs = nowApply.filter(j => j.rank === 'S');
  const aJobs = nowApply.filter(j => j.rank === 'A');
  const pendingJobs = nowApply.filter(j => j.displayTier === 'now_pending');

  const todayTop = nowApply.slice(0, 5);
  const rest = nowApply.slice(5);

  const todayTopCards = todayTop.map((job, i) => renderJobCard(job, i, true)).join('\n');
  const nowRestCards = renderRankSections(rest, todayTop.length);
  const holdCards = renderRankSections(holds, 0);
  const highValueCards = renderRankSections(highValueChallenge, 0);
  const normalChallengeCards = renderRankSections(normalChallenge, 0);
  const confirmCards = renderRankSections(confirmCandidates, 0);

  // チャレンジ枠（高単価・通常）に共通する不足資産を集計（重複をまとめて一覧化）
  const challengeJobs = [...highValueChallenge, ...normalChallenge];
  const missingAssetCounts = challengeJobs.reduce((acc, j) => {
    (j.missingAssets || []).forEach(m => { acc[m] = (acc[m] || 0) + 1; });
    return acc;
  }, {});
  const missingAssetList = Object.entries(missingAssetCounts).sort((a, b) => b[1] - a[1]);

  // 応募可能性ゲートで新規に見送りとなった件数（応募済み・見送り済み・既出は除く＝今回のゲート判定のみ）
  const gateRejectedCount = excluded.filter(j => !['応募済み', '見送り', '既出'].includes(j.excludeReason)).length;

  const reasonCounts = excluded.reduce((acc, j) => {
    acc[j.excludeReason] = (acc[j.excludeReason] || 0) + 1;
    return acc;
  }, {});
  const reasonOrder = ['応募済み', '見送り', '既出', '単価が低すぎる', '条件不一致', '条件不一致（属性）', 'SNS運用代行', 'リスクあり', '必須条件不一致（資格・専門実務）', '必須条件不一致（指定ツール）', '対応不可（Knowledge判定）'];
  let excludedHtml = '';
  for (const reason of reasonOrder) {
    const list = excluded.filter(j => j.excludeReason === reason);
    if (list.length === 0) continue;
    const color = getReasonColor(reason);
    excludedHtml += `<div class="rank-section-header" style="border-left:4px solid ${color}">
      <span style="color:${color}">${escapeHtml(reason)}</span>
      <span class="count-badge" style="background:${color}">${list.length}件</span>
    </div>`;
    excludedHtml += list.map(renderExcludedCard).join('\n');
  }
  if (excluded.length === 0) {
    excludedHtml = '<div class="saved-empty">今回は除外案件がありません</div>';
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="AI案件">
  <link rel="manifest" href="manifest.json">
  <title>【AI案件】${dateStr}</title>
  <style>
    :root {
      --primary: #1a1a2e;
      --accent: #e74c3c;
      --bg: #f0f2f5;
      --card-bg: #ffffff;
      --text: #2c3e50;
      --text-muted: #7f8c8d;
      --radius: 14px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif;
      background: var(--bg);
      color: var(--text);
      padding-bottom: 80px;
    }

    /* ===== ヘッダー ===== */
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
      color: white;
      padding: 20px 16px 16px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 1rem; font-weight: 700; }
    .header .date { font-size: 0.75rem; opacity: 0.7; margin-top: 2px; }
    .header-stats {
      display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap;
    }
    .stat-chip {
      background: rgba(255,255,255,0.15);
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .stat-chip.s { background: rgba(231,76,60,0.6); }
    .stat-chip.a { background: rgba(230,126,34,0.6); }
    .stat-chip.b { background: rgba(39,174,96,0.4); }

    /* ===== タブ ===== */
    .tab-bar {
      display: flex;
      background: white;
      border-bottom: 2px solid #e0e0e0;
      position: sticky;
      top: 82px;
      z-index: 99;
      overflow-x: auto;
    }
    .tab {
      flex: 1;
      padding: 10px 4px;
      text-align: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 3px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .tab.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }

    /* ===== コンテンツエリア ===== */
    .tab-content { display: none; padding: 12px; }
    .tab-content.active { display: block; }

    /* ===== TOP3セクション ===== */
    .top3-header {
      background: linear-gradient(135deg, #e74c3c, #c0392b);
      color: white;
      padding: 10px 14px;
      border-radius: var(--radius) var(--radius) 0 0;
      font-weight: 700;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .top3-section {
      margin-bottom: 20px;
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(231,76,60,0.2);
    }

    /* ===== ランクセクション ===== */
    .rank-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      margin: 16px 0 8px;
      background: white;
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.9rem;
    }
    .count-badge {
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.75rem;
    }

    /* ===== 案件カード ===== */
    .job-card {
      background: var(--card-bg);
      border-radius: var(--radius);
      padding: 14px;
      margin-bottom: 10px;
      border-left: 4px solid #ddd;
      box-shadow: 0 1px 6px rgba(0,0,0,0.07);
    }
    .top3-card {
      border-radius: 0;
      margin-bottom: 1px;
      box-shadow: none;
    }
    .top3-card:last-child { border-radius: 0 0 var(--radius) var(--radius); margin-bottom: 0; }

    .job-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .job-number {
      color: white;
      width: 24px; height: 24px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.75rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .rank-badge {
      color: white;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .top3-badge {
      background: #fff3cd;
      color: #856404;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .promoted-badge {
      background: #e0e0e0;
      color: #555;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .tier-badge {
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .genre-tag {
      background: #ecf0f1;
      color: #555;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
    }
    .capability-badge {
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .decision-source {
      font-size: 0.7rem;
      color: #888;
      margin-top: 4px;
    }

    .job-title {
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .job-title a { color: var(--text); text-decoration: none; }

    .job-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 10px;
    }
    .meta-item {
      background: #f8f9fa;
      padding: 3px 8px;
      border-radius: 8px;
      font-size: 0.75rem;
      color: #555;
    }
    .keyword-tag { background: #e8f4fd; color: #2980b9; }

    .scores {
      background: rgba(0,0,0,0.03);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 10px;
    }
    .score-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 0;
    }
    .score-label { font-size: 0.75rem; color: #666; }
    .score-stars { font-size: 0.85rem; color: #f39c12; letter-spacing: 1px; }

    .detail-section {
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 6px;
      font-size: 0.82rem;
    }
    .detail-section.reason { background: #f0f8f0; }
    .detail-section.caution { background: #fff8f0; }
    .detail-section.strength { background: #f0f0ff; }
    .detail-section.missing { background: #fdf0f0; }
    .detail-section.highvalue { background: #fdf1e6; border: 1px solid #f0c896; }
    .detail-section.confirm { background: #eef6fb; }
    .detail-label { font-weight: 700; font-size: 0.73rem; margin-bottom: 3px; color: #555; }
    .detail-text { line-height: 1.5; color: #333; }
    .signal-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .signal-chip {
      background: #dff0d8;
      color: #2e7d32;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.76rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .btn-view {
      flex: 1;
      display: block;
      background: #3498db;
      color: white;
      text-align: center;
      padding: 10px;
      border-radius: 10px;
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 700;
    }
    .btn-save {
      background: #f8f9fa;
      border: 2px solid #ddd;
      color: #555;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .btn-save.saved {
      background: #fff3cd;
      border-color: #ffc107;
      color: #856404;
    }
    .btn-applied {
      background: #f8f9fa;
      border: 2px solid #ddd;
      color: #555;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .btn-applied.applied {
      background: #eaf4ea;
      border-color: #27ae60;
      color: #1a7a40;
    }
    .job-card.applied-card {
      opacity: 0.4;
      position: relative;
    }
    .applied-overlay {
      display: none;
      position: absolute;
      top: 8px; right: 8px;
      background: #27ae60;
      color: white;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .job-card.applied-card .applied-overlay { display: inline-block; }

    .btn-skip {
      background: #f8f9fa;
      border: 2px solid #ddd;
      color: #555;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .btn-skip.skipped {
      background: #eceff1;
      border-color: #607d8b;
      color: #37474f;
    }
    .job-card.skipped-card {
      opacity: 0.4;
      position: relative;
    }
    .skipped-overlay {
      display: none;
      position: absolute;
      top: 8px; right: 8px;
      background: #607d8b;
      color: white;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .job-card.skipped-card .skipped-overlay { display: inline-block; }
    .skip-reason-text {
      font-size: 0.75rem;
      color: #607d8b;
      margin-top: 4px;
    }

    /* ===== 除外カード ===== */
    .excluded-card {
      background: var(--card-bg);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
      opacity: 0.75;
      box-shadow: 0 1px 4px rgba(0,0,0,0.05);
    }
    .excluded-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .reason-badge {
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .excluded-title { font-size: 0.85rem; margin-bottom: 4px; }
    .excluded-title a { color: var(--text); text-decoration: none; }

    /* ===== 候補リストタブ ===== */
    .saved-empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1.8;
    }
    .saved-item {
      background: white;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.07);
    }
    .saved-rank {
      font-weight: 700;
      font-size: 0.9rem;
      min-width: 28px;
    }
    .saved-title {
      flex: 1;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .saved-title a { color: var(--text); text-decoration: none; }
    .btn-remove {
      background: none;
      border: none;
      color: #ccc;
      font-size: 1.2rem;
      cursor: pointer;
      padding: 4px;
    }
    .share-box {
      background: #e8f4fd;
      border-radius: 10px;
      padding: 12px;
      margin-top: 16px;
      font-size: 0.82rem;
      line-height: 1.6;
    }
    .share-box textarea {
      width: 100%;
      border: 1px solid #bee5f8;
      border-radius: 8px;
      padding: 8px;
      font-size: 0.82rem;
      resize: none;
      background: white;
      margin-top: 6px;
      font-family: inherit;
    }
    .btn-copy {
      margin-top: 8px;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.82rem;
      cursor: pointer;
      font-weight: 600;
    }
    .applied-export-box {
      background: #eaf4ea;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 0.8rem;
      line-height: 1.6;
    }
    .applied-export-box textarea {
      width: 100%;
      border: 1px solid #b7ddb7;
      border-radius: 8px;
      padding: 8px;
      font-size: 0.78rem;
      resize: none;
      background: white;
      margin-top: 6px;
      font-family: monospace;
    }

    /* ===== フッター固定ボタン ===== */
    .footer-fab {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 50%;
      width: 52px; height: 52px;
      font-size: 1.4rem;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
    }
    .saved-count-badge {
      position: absolute;
      top: -4px; right: -4px;
      background: var(--accent);
      color: white;
      border-radius: 50%;
      width: 20px; height: 20px;
      font-size: 0.65rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #applied-filter-bar, #skip-filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      background: white;
      padding: 8px 12px;
      border-radius: 10px;
      margin-bottom: 10px;
      font-size: 0.82rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.07);
    }
    #applied-filter-bar label, #skip-filter-bar label { cursor: pointer; color: #555; }

    /* ===== 更新時刻 ===== */
    .update-info {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.72rem;
      padding: 10px 0 4px;
    }
  </style>
</head>
<body>

  <!-- ヘッダー -->
  <div class="header">
    <div class="header-top">
      <div>
        <h1>📋 今日の応募候補</h1>
        <div class="date">${dateStr}</div>
      </div>
    </div>
    <div class="header-stats">
      <span class="stat-chip s">🔴 今日の最優先(S) ${sJobs.length}件</span>
      <span class="stat-chip a">🟠 優先応募(A) ${aJobs.length}件</span>
      <span class="stat-chip" style="background:rgba(211,84,0,0.55)">🔥 高単価チャレンジ ${highValueChallenge.length}件</span>
      <span class="stat-chip">🌱 通常チャレンジ ${normalChallenge.length}件</span>
      <span class="stat-chip" style="background:rgba(142,68,173,0.55)">❓ 確認候補 ${confirmCandidates.length}件</span>
      <span class="stat-chip">🚫 見送り ${gateRejectedCount}件</span>
      <span class="stat-chip">🧩 不足資産 ${missingAssetList.length}件</span>
      <span class="stat-chip">保留 ${holds.length}件</span>
      <span class="stat-chip">除外 ${excluded.length}件</span>
    </div>
  </div>

  <!-- タブバー -->
  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('now', this)">📋 今すぐ応募</div>
    <div class="tab" onclick="switchTab('highvalue', this)">🔥 高単価チャレンジ</div>
    <div class="tab" onclick="switchTab('normal', this)">🌱 通常チャレンジ</div>
    <div class="tab" onclick="switchTab('confirm', this)">❓ 確認候補</div>
    <div class="tab" onclick="switchTab('holds', this)">⏸ 保留</div>
    <div class="tab" onclick="switchTab('excluded', this)">🚫 除外</div>
    <div class="tab" onclick="switchTab('saved', this)">🔖 候補リスト</div>
  </div>

  <!-- 今すぐ応募タブ -->
  <div id="tab-now" class="tab-content active">
    <div class="update-info">最終更新: ${date.toLocaleString('ja-JP')}</div>
    <div id="applied-filter-bar">
      <input type="checkbox" id="hide-applied" onchange="applyAppliedFilter()" checked>
      <label for="hide-applied">応募済み案件を非表示にする</label>
    </div>

    <!-- TODAY TOP（今日応募すべき案件） -->
    <div class="top3-section">
      <div class="top3-header">🎯 今日応募すべき案件（capabilityStatus=応募可能・直接証明/強い代替証明、最大5件。無理な枠埋めはしません）</div>
      ${todayTopCards || '<div class="saved-empty" style="background:white">本日は「今すぐ応募」の候補がありません。無理に低品質案件では埋めていません</div>'}
    </div>
    ${pendingJobs.length > 0 ? `<div class="update-info">⏳ 条件確認後に応募（報酬額など要確認、${pendingJobs.length}件）はカード内バッジで区別されています</div>` : ''}

    <!-- 残り今すぐ応募候補 -->
    ${nowRestCards}
  </div>

  <!-- 高単価チャレンジタブ -->
  <div id="tab-highvalue" class="tab-content">
    <div class="update-info">🔥 直接実績は不足していても、強い代替証明があり、単価・継続性・長期資産性のいずれかが高い案件。実績獲得目的で積極的にチャレンジ応募する枠</div>
    ${highValueCards || '<div class="saved-empty">高単価チャレンジ候補はありません</div>'}
  </div>

  <!-- 通常チャレンジタブ -->
  <div id="tab-normal" class="tab-content">
    <div class="update-info">🌱 実績獲得目的のチャレンジ候補（高単価チャレンジ基準には届かないが、応募理由は作れる案件）</div>
    ${missingAssetList.length > 0 ? `
    <div class="detail-section missing" style="margin-bottom:12px">
      <div class="detail-label">🧩 今回見つかった営業資産の不足（重複をまとめて集計）</div>
      <div class="detail-text">
        ${missingAssetList.map(([name, count]) => `${escapeHtml(name)}（${count}件）`).join('<br>')}
      </div>
    </div>` : ''}
    ${normalChallengeCards || '<div class="saved-empty">通常チャレンジ候補はありません</div>'}
  </div>

  <!-- 確認候補タブ -->
  <div id="tab-confirm" class="tab-content">
    <div class="update-info">❓ 案件辞典・能力辞典のいずれでも応募可能／対応不可と断定できない案件。除外せず、永峯勇気本人の確認に委ねる枠</div>
    ${confirmCards || '<div class="saved-empty">確認候補はありません</div>'}
  </div>

  <!-- 保留タブ -->
  <div id="tab-holds" class="tab-content">
    <div class="update-info">単価不明等、情報不足で判断できない案件のみ（今後の参考用）</div>
    ${holdCards || '<div class="saved-empty">保留案件はありません</div>'}
  </div>

  <!-- 除外タブ -->
  <div id="tab-excluded" class="tab-content">
    <div class="update-info">応募済み・見送り・既出・単価が低い・条件不一致・SNS運用代行・リスクありの案件（理由付き）</div>
    <div id="skip-filter-bar">
      <input type="checkbox" id="show-skipped" onchange="applySkippedFilter()">
      <label for="show-skipped">見送り案件も表示する</label>
    </div>
    ${excludedHtml}
  </div>

  <!-- 候補リストタブ -->
  <div id="tab-saved" class="tab-content">
    <div id="applied-export-container"></div>
    <div id="skipped-export-container"></div>
    <div id="saved-list-container">
      <div class="saved-empty">
        🔖 「候補に追加」を押した案件がここに表示されます<br><br>
        気になる案件を3件選んで、ChatGPTへ共有しましょう
      </div>
    </div>
  </div>

  <!-- FABボタン（候補リストへ） -->
  <button class="footer-fab" onclick="switchTab('saved', null)" style="position:relative">
    🔖
    <span id="saved-count-badge" class="saved-count-badge" style="display:none">0</span>
  </button>

  <script>
    // ===== タブ切り替え =====
    const TAB_NAMES = ['now', 'highvalue', 'normal', 'confirm', 'holds', 'excluded', 'saved'];
    function switchTab(name, el) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      if (el) el.classList.add('active');
      else {
        const idx = TAB_NAMES.indexOf(name);
        const tabs = document.querySelectorAll('.tab');
        if (tabs[idx]) tabs[idx].classList.add('active');
      }
      if (name === 'saved') renderSavedList();
    }

    // ===== 候補保存（localStorage） =====
    const STORAGE_KEY = 'ai_jobs_saved_v2';

    function getSaved() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
      catch { return []; }
    }
    function setSaved(list) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function toggleSave(id, title, url, rank) {
      let saved = getSaved();
      const exists = saved.find(j => j.id === id);
      if (exists) {
        saved = saved.filter(j => j.id !== id);
      } else {
        saved.push({ id, title, url, rank, savedAt: new Date().toISOString() });
      }
      setSaved(saved);
      updateSaveButtons();
    }

    function updateSaveButtons() {
      const saved = getSaved();
      const ids = new Set(saved.map(j => j.id));
      document.querySelectorAll('.job-card').forEach(card => {
        const id = card.dataset.id;
        const btn = card.querySelector('.btn-save');
        const text = card.querySelector('.save-text');
        if (!btn) return;
        if (ids.has(id)) {
          btn.classList.add('saved');
          if (text) text.textContent = '候補に追加済み';
        } else {
          btn.classList.remove('saved');
          if (text) text.textContent = '候補に追加';
        }
      });
      const badge = document.getElementById('saved-count-badge');
      badge.textContent = saved.length;
      badge.style.display = saved.length > 0 ? 'flex' : 'none';
    }

    function renderSavedList() {
      const saved = getSaved();
      const container = document.getElementById('saved-list-container');
      renderAppliedExport();
      renderSkippedExport();
      if (saved.length === 0) {
        container.innerHTML = '<div class="saved-empty">🔖 「候補に追加」を押した案件がここに表示されます<br><br>気になる案件を3件選んで、ChatGPTへ共有しましょう</div>';
        return;
      }
      const rankColors = { S: '#e74c3c', A: '#e67e22', B: '#27ae60', C: '#7f8c8d' };
      let html = '<div style="padding:12px 0">';
      html += '<div style="font-size:0.82rem; color:#666; margin-bottom:10px">候補リスト（' + saved.length + '件） — ChatGPTへコピーして応募文を作成しましょう</div>';
      saved.forEach(j => {
        html += '<div class="saved-item">';
        html += '<span class="saved-rank" style="color:' + (rankColors[j.rank]||'#333') + '">' + j.rank + '</span>';
        html += '<span class="saved-title"><a href="' + j.url + '" target="_blank">' + escHtml(j.title) + '</a></span>';
        html += '<button class="btn-remove" onclick="removeSaved(\\'' + j.id + '\\')" title="削除">✕</button>';
        html += '</div>';
      });

      // ChatGPT共有テキスト生成
      const shareText = generateShareText(saved);
      html += '<div class="share-box">';
      html += '<div style="font-weight:700; margin-bottom:4px">📤 ChatGPTへ共有するテキスト</div>';
      html += '<textarea id="share-textarea" rows="8" readonly>' + escHtml(shareText) + '</textarea>';
      html += '<button class="btn-copy" onclick="copyShareText()">📋 コピーする</button>';
      html += '</div>';
      html += '</div>';
      container.innerHTML = html;
    }

    function removeSaved(id) {
      const saved = getSaved().filter(j => j.id !== id);
      setSaved(saved);
      updateSaveButtons();
      renderSavedList();
    }

    function generateShareText(saved) {
      let text = '以下のクラウドワークス案件に応募したいです。\\n';
      text += '私のプロフィール：飲食業界22年・店長マネージャー経験・ChatGPT/Claude活用・業務改善得意・採用面接300名以上\\n\\n';
      saved.forEach((j, i) => {
        text += (i+1) + '. 【' + j.rank + 'ランク】' + j.title + '\\n';
        text += '   URL: ' + j.url + '\\n\\n';
      });
      text += 'それぞれに合った応募文を書いてください。';
      return text;
    }

    function copyShareText() {
      const ta = document.getElementById('share-textarea');
      navigator.clipboard.writeText(ta.value).then(() => {
        const btn = document.querySelector('.btn-copy');
        btn.textContent = '✅ コピーしました';
        setTimeout(() => { btn.textContent = '📋 コピーする'; }, 2000);
      }).catch(() => {
        ta.select();
        document.execCommand('copy');
      });
    }

    function escHtml(str) {
      return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ===== 応募済み管理 =====
    // ここでの「応募済み」はブラウザ内の一時的な表示切替のみ。
    // 次回検索で永久に除外するには、ターミナルで mark-applied.js を実行して data/applied_jobs.json に登録する。
    const APPLIED_KEY = 'ai_jobs_applied_v1';

    function getApplied() {
      try { return JSON.parse(localStorage.getItem(APPLIED_KEY) || '[]'); }
      catch { return []; }
    }
    function setApplied(list) {
      localStorage.setItem(APPLIED_KEY, JSON.stringify(list));
    }

    function toggleApplied(id, title, url) {
      let applied = getApplied();
      const exists = applied.find(j => j.id === id);
      if (exists) {
        applied = applied.filter(j => j.id !== id);
      } else {
        applied.push({ id, title, url, appliedAt: new Date().toISOString() });
      }
      setApplied(applied);
      updateAppliedButtons();
      applyAppliedFilter();
      renderAppliedExport();
    }

    function updateAppliedButtons() {
      const applied = getApplied();
      const ids = new Set(applied.map(j => j.id));
      document.querySelectorAll('.job-card').forEach(card => {
        const id = card.dataset.id;
        const btn = card.querySelector('.btn-applied');
        const text = card.querySelector('.applied-text');
        if (!btn) return;
        if (ids.has(id)) {
          btn.classList.add('applied');
          card.classList.add('applied-card');
          if (text) text.textContent = '↩ 応募済み解除';
        } else {
          btn.classList.remove('applied');
          card.classList.remove('applied-card');
          if (text) text.textContent = '✅ 応募済み';
        }
      });
    }

    function applyAppliedFilter() {
      const hide = document.getElementById('hide-applied') && document.getElementById('hide-applied').checked;
      const applied = getApplied();
      const ids = new Set(applied.map(j => j.id));
      document.querySelectorAll('.job-card').forEach(card => {
        if (ids.has(card.dataset.id)) {
          card.style.display = hide ? 'none' : '';
        }
      });
    }

    function renderAppliedExport() {
      const container = document.getElementById('applied-export-container');
      if (!container) return;
      const applied = getApplied();
      if (applied.length === 0) {
        container.innerHTML = '';
        return;
      }
      const ids = applied.map(j => j.id).join(' ');
      const cmd = 'node mark-applied.js ' + ids;
      container.innerHTML =
        '<div class="applied-export-box">' +
        '<div style="font-weight:700; margin-bottom:4px">✅ 応募済み登録コマンド（PCのターミナルで実行）</div>' +
        '<div>このコマンドを実行すると、次回以降の検索でこれらの案件を表示しなくなります。</div>' +
        '<textarea id="applied-export-textarea" rows="2" readonly>' + escHtml(cmd) + '</textarea>' +
        '<button class="btn-copy" onclick="copyAppliedExport()">📋 コマンドをコピー</button>' +
        '</div>';
    }

    function copyAppliedExport() {
      const ta = document.getElementById('applied-export-textarea');
      navigator.clipboard.writeText(ta.value).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = '✅ コピーしました';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }).catch(() => {
        ta.select();
        document.execCommand('copy');
      });
    }

    // ===== 見送り管理 =====
    // ここでの「見送り」もブラウザ内の一時保存のみ。
    // 次回検索で永久に除外するには、ターミナルで mark-skipped.js を実行して data/job_status.json に登録する。
    const SKIPPED_KEY = 'ai_jobs_skipped_v1';

    function getSkipped() {
      try { return JSON.parse(localStorage.getItem(SKIPPED_KEY) || '[]'); }
      catch { return []; }
    }
    function setSkipped(list) {
      localStorage.setItem(SKIPPED_KEY, JSON.stringify(list));
    }

    function toggleSkip(id, title, url) {
      let skipped = getSkipped();
      const exists = skipped.find(j => j.id === id);
      if (exists) {
        skipped = skipped.filter(j => j.id !== id);
      } else {
        const reason = window.prompt('見送り理由を入力してください（省略可）', '') || '理由未記入';
        skipped.push({ id, title, url, reason, skippedAt: new Date().toISOString() });
      }
      setSkipped(skipped);
      updateSkipButtons();
      renderSkippedExport();
    }

    function updateSkipButtons() {
      const skipped = getSkipped();
      const ids = new Set(skipped.map(j => j.id));
      document.querySelectorAll('.job-card').forEach(card => {
        const id = card.dataset.id;
        const btn = card.querySelector('.btn-skip');
        const text = card.querySelector('.skip-text');
        if (!btn) return;
        if (ids.has(id)) {
          btn.classList.add('skipped');
          card.classList.add('skipped-card');
          if (text) text.textContent = '↩ 見送り解除';
        } else {
          btn.classList.remove('skipped');
          card.classList.remove('skipped-card');
          if (text) text.textContent = '⏭ 見送り';
        }
      });
    }

    function applySkippedFilter() {
      const show = document.getElementById('show-skipped') && document.getElementById('show-skipped').checked;
      document.querySelectorAll('.excluded-card').forEach(card => {
        if (card.dataset.reason === '見送り') {
          card.style.display = show ? '' : 'none';
        }
      });
    }

    function renderSkippedExport() {
      const container = document.getElementById('skipped-export-container');
      if (!container) return;
      const skipped = getSkipped();
      if (skipped.length === 0) {
        container.innerHTML = '';
        return;
      }
      const args = skipped.map(j => '"' + j.id + '|' + j.reason.replace(/"/g, '') + '"').join(' ');
      const cmd = 'node mark-skipped.js ' + args;
      container.innerHTML =
        '<div class="applied-export-box">' +
        '<div style="font-weight:700; margin-bottom:4px">⏭ 見送り登録コマンド（PCのターミナルで実行）</div>' +
        '<div>このコマンドを実行すると、次回以降の検索でこれらの案件を表示しなくなります。</div>' +
        '<textarea id="skipped-export-textarea" rows="2" readonly>' + escHtml(cmd) + '</textarea>' +
        '<button class="btn-copy" onclick="copySkippedExport()">📋 コマンドをコピー</button>' +
        '</div>';
    }

    function copySkippedExport() {
      const ta = document.getElementById('skipped-export-textarea');
      navigator.clipboard.writeText(ta.value).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = '✅ コピーしました';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }).catch(() => {
        ta.select();
        document.execCommand('copy');
      });
    }

    // 初期化
    updateSaveButtons();
    updateAppliedButtons();
    applyAppliedFilter();
    updateSkipButtons();
    applySkippedFilter();
  </script>
</body>
</html>`;
}

function renderMarkdown({ nowApply, highValueChallenge = [], normalChallenge = [], confirmCandidates = [], holds, excluded }, date) {
  const dateStr = date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const todayTop = nowApply.slice(0, 5);
  const gateRejectedCount = excluded.filter(j => !['応募済み', '見送り', '既出'].includes(j.excludeReason)).length;
  const challengeJobs = [...highValueChallenge, ...normalChallenge];
  const missingAssetCounts = challengeJobs.reduce((acc, j) => {
    (j.missingAssets || []).forEach(m => { acc[m] = (acc[m] || 0) + 1; });
    return acc;
  }, {});
  const missingAssetList = Object.entries(missingAssetCounts).sort((a, b) => b[1] - a[1]);

  let md = `# 今日の応募候補\n\n**日付**: ${dateStr}\n\n`;
  md += `今日の最優先応募(S) ${nowApply.filter(j => j.rank === 'S').length}件 / `;
  md += `優先応募(A) ${nowApply.filter(j => j.rank === 'A').length}件 / `;
  md += `🔥高単価チャレンジ ${highValueChallenge.length}件 / 🌱通常チャレンジ ${normalChallenge.length}件 / ❓確認候補 ${confirmCandidates.length}件 / 見送り ${gateRejectedCount}件 / 不足資産 ${missingAssetList.length}件\n\n`;
  md += `保留 ${holds.length}件 / 除外 ${excluded.length}件\n\n`;

  md += `## 🎯 今日応募すべき案件（今すぐ応募、最大5件。無理な枠埋めはしません）\n\n`;
  if (todayTop.length === 0) md += `本日は「今すぐ応募」の候補がありません。\n\n`;
  todayTop.forEach((job, i) => {
    md += `### ${i + 1}. ${job.title}${job.displayTier === 'now_pending' ? '（⏳条件確認後に応募）' : ''}\n\n`;
    md += `- URL: ${job.url}\n`;
    md += `- 報酬: ${job.price || '要確認'}\n`;
    md += `- ランク: **${job.rank}**（証拠の強さ: ${job.evidenceStrength}）\n`;
    md += `- 職能一致度: ${toStars(job.categoryScore)}\n`;
    md += `- この案件を選ぶ理由:\n${job.reason.split('\n').map(l => `  ${l}`).join('\n')}\n`;
    md += `- 提案文の軸:\n${job.strengthHint.split('\n').map(l => `  ${l}`).join('\n')}\n\n`;
    md += `---\n\n`;
  });

  md += `## 📋 今すぐ応募（全${nowApply.length}件）\n\n`;
  nowApply.forEach((job, i) => {
    md += `${i + 1}. [${job.rank}]${job.displayTier === 'now_pending' ? '[条件確認後]' : ''} ${job.title}\n   URL: ${job.url}\n   報酬: ${job.price || '要確認'}\n   証拠の強さ: ${job.evidenceStrength}\n   応募理由: ${job.reason}\n\n`;
  });

  md += `## 🔥 高単価チャレンジ（全${highValueChallenge.length}件）\n\n`;
  md += `直接実績は不足していても、強い代替証明があり、単価・継続性・長期資産性のいずれかが高い案件。\n\n`;
  highValueChallenge.forEach((job, i) => {
    md += `${i + 1}. ${job.title}\n   URL: ${job.url}\n   報酬: ${job.price || '要確認'}\n   高単価と判断した理由: ${(job.highValueSignals || []).map(s => s.text).join('、') || 'なし'}\n   不足資産: ${(job.missingAssets || []).join('、') || 'なし'}\n\n`;
  });

  md += `## 🌱 通常チャレンジ（全${normalChallenge.length}件）\n\n`;
  md += `実績獲得目的のチャレンジ候補（高単価チャレンジ基準には届かないが、応募理由は作れる案件）。\n\n`;
  if (missingAssetList.length > 0) {
    md += `### 今回見つかった営業資産の不足（高単価・通常チャレンジ合算）\n\n`;
    missingAssetList.forEach(([name, count]) => { md += `- ${name}（${count}件）\n`; });
    md += `\n`;
  }
  normalChallenge.forEach((job, i) => {
    md += `${i + 1}. ${job.title}\n   URL: ${job.url}\n   報酬: ${job.price || '要確認'}\n   不足資産: ${(job.missingAssets || []).join('、') || 'なし'}\n\n`;
  });

  md += `## ❓ 確認候補（全${confirmCandidates.length}件）\n\n`;
  md += `案件辞典・能力辞典のいずれでも応募可能／対応不可と断定できない案件。除外していません。\n\n`;
  confirmCandidates.forEach((job, i) => {
    md += `${i + 1}. ${job.title}\n   URL: ${job.url}\n   報酬: ${job.price || '要確認'}\n   確認候補になった理由: ${job.capabilityReason}\n   応募前に確認すべき条件: ${(job.confirmBeforeApply || []).join('、') || 'なし'}\n\n`;
  });

  md += `## ⏸ 保留（全${holds.length}件）\n\n`;
  holds.forEach((job, i) => {
    md += `${i + 1}. [${job.rank}] ${job.title}\n   URL: ${job.url}\n   報酬: ${job.price || '要確認'}\n\n`;
  });

  md += `## 🚫 除外（全${excluded.length}件）\n\n`;
  const reasonOrder = ['応募済み', '見送り', '既出', '単価が低すぎる', '条件不一致', '条件不一致（属性）', 'SNS運用代行', 'リスクあり', '必須条件不一致（資格・専門実務）', '必須条件不一致（指定ツール）', '対応不可（Knowledge判定）'];
  for (const reason of reasonOrder) {
    const list = excluded.filter(j => j.excludeReason === reason);
    if (list.length === 0) continue;
    md += `### ${reason}（${list.length}件）\n\n`;
    list.forEach(job => {
      md += `- ${job.title}\n  URL: ${job.url}${job.skipReason ? `\n  見送り理由: ${job.skipReason}` : ''}\n`;
    });
    md += `\n`;
  }

  return md;
}

module.exports = { renderHTML, renderMarkdown };
