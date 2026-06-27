const { toStars } = require('./evaluator');

function getRankColor(rank) {
  return { S: '#e74c3c', A: '#e67e22', B: '#27ae60', C: '#7f8c8d' }[rank] || '#333';
}

function getRankBg(rank) {
  return { S: '#fef5f5', A: '#fff8f0', B: '#f0fff4', C: '#f5f5f5' }[rank] || '#fff';
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

  return `
    <div class="job-card rank-${job.rank.toLowerCase()}${isTop3 ? ' top3-card' : ''}"
         data-id="${job.id}"
         style="border-left-color:${rankColor}; background:${rankBg}">

      <div class="job-header">
        <span class="job-number" style="background:${rankColor}">${i + 1}</span>
        <span class="rank-badge" style="background:${rankColor}">${job.rank}ランク</span>
        ${isTop3 ? '<span class="top3-badge">🎯 TODAY TOP</span>' : ''}
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
          <span class="score-label">AI実績</span>
          <span class="score-stars">${toStars(job.aiScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">独立につながる</span>
          <span class="score-stars">${toStars(job.independenceScore)}</span>
        </div>
        <div class="score-row">
          <span class="score-label">受注可能性</span>
          <span class="score-stars">${toStars(job.winScore)}</span>
        </div>
      </div>

      <div class="detail-section reason">
        <div class="detail-label">✅ 応募すべき理由</div>
        <div class="detail-text">${escapeHtml(job.reason)}</div>
      </div>

      <div class="detail-section strength">
        <div class="detail-label">💡 提案文の軸</div>
        <div class="detail-text">${escapeHtml(job.strengthHint)}</div>
      </div>

      <div class="detail-section caution">
        <div class="detail-label">⚠️ 注意点</div>
        <div class="detail-text">${escapeHtml(job.caution)}</div>
      </div>

      <div class="card-actions">
        <a href="${job.url}" target="_blank" class="btn-view">案件を見る →</a>
        <button class="btn-save" onclick="toggleSave('${job.id}', '${escapeHtml(job.title.replace(/'/g, ''))}', '${job.url}', '${job.rank}')">
          <span class="save-icon">🔖</span> <span class="save-text">候補に追加</span>
        </button>
      </div>
    </div>
  `;
}

function renderHTML(jobs, date, pageUrl) {
  const dateStr = date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const sJobs = jobs.filter(j => j.rank === 'S');
  const aJobs = jobs.filter(j => j.rank === 'A');
  const bJobs = jobs.filter(j => j.rank === 'B');
  const cJobs = jobs.filter(j => j.rank === 'C');

  const top3 = jobs.slice(0, 3);
  const rest = jobs.slice(3);

  const top3Cards = top3.map((job, i) => renderJobCard(job, i + 1, true)).join('\n');

  let restCards = '';
  let counter = top3.length + 1;

  const sections = [
    { label: 'Sランク', list: rest.filter(j => j.rank === 'S'), color: '#e74c3c' },
    { label: 'Aランク', list: rest.filter(j => j.rank === 'A'), color: '#e67e22' },
    { label: 'Bランク', list: rest.filter(j => j.rank === 'B'), color: '#27ae60' },
    { label: 'Cランク', list: rest.filter(j => j.rank === 'C'), color: '#7f8c8d' },
  ];

  for (const sec of sections) {
    if (sec.list.length === 0) continue;
    restCards += `<div class="rank-section-header" style="border-left:4px solid ${sec.color}">
      <span style="color:${sec.color}">${sec.label}</span>
      <span class="count-badge" style="background:${sec.color}">${sec.list.length}件</span>
    </div>`;
    for (const job of sec.list) {
      restCards += renderJobCard(job, counter++);
    }
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
    }
    .tab {
      flex: 1;
      padding: 10px 4px;
      text-align: center;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 3px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
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
    .genre-tag {
      background: #ecf0f1;
      color: #555;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
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
    .detail-label { font-weight: 700; font-size: 0.73rem; margin-bottom: 3px; color: #555; }
    .detail-text { line-height: 1.5; color: #333; }

    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
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
      <span class="stat-chip s">🔴 S ${sJobs.length}件</span>
      <span class="stat-chip a">🟠 A ${aJobs.length}件</span>
      <span class="stat-chip b">🟢 B ${bJobs.length}件</span>
      <span class="stat-chip">全${jobs.length}件</span>
    </div>
  </div>

  <!-- タブバー -->
  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('all', this)">📋 全案件</div>
    <div class="tab" onclick="switchTab('saved', this)">🔖 候補リスト</div>
  </div>

  <!-- 全案件タブ -->
  <div id="tab-all" class="tab-content active">
    <div class="update-info">最終更新: ${date.toLocaleString('ja-JP')}</div>

    <!-- TOP3 -->
    <div class="top3-section">
      <div class="top3-header">🎯 今日応募するならこの3件</div>
      ${top3Cards}
    </div>

    <!-- 残り案件 -->
    ${restCards}
  </div>

  <!-- 候補リストタブ -->
  <div id="tab-saved" class="tab-content">
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
    function switchTab(name, el) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      if (el) el.classList.add('active');
      else {
        const tabs = document.querySelectorAll('.tab');
        if (name === 'saved') tabs[1].classList.add('active');
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
      if (saved.length === 0) {
        container.innerHTML = '<div class="saved-empty">🔖 「候補に追加」を押した案件がここに表示されます<br><br>気になる案件を3件選んで、ChatGPTへ共有しましょう</div>';
        return;
      }
      const rankColors = { S: '#e74c3c', A: '#e67e22', B: '#27ae60', C: '#7f8c8d' };
      let html = '<div style="padding:12px">';
      html += '<div style="font-size:0.82rem; color:#666; margin-bottom:10px">候補リスト（' + saved.length + '件） — ChatGPTへコピーして応募文を作成しましょう</div>';
      saved.forEach(j => {
        html += '<div class="saved-item">';
        html += '<span class="saved-rank" style="color:' + (rankColors[j.rank]||'#333') + '">' + j.rank + '</span>';
        html += '<span class="saved-title"><a href="' + j.url + '" target="_blank">' + escHtml(j.title) + '</a></span>';
        html += '<button class="btn-remove" onclick="removeSaved(\'' + j.id + '\')" title="削除">✕</button>';
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

    // 初期化
    updateSaveButtons();
  </script>
</body>
</html>`;
}

function renderMarkdown(jobs, date) {
  const dateStr = date.toLocaleDateString('ja-JP');
  const top3 = jobs.slice(0, 3);
  let md = `# 今日の応募候補\n\n**日付**: ${dateStr}\n\n`;
  md += `## 🎯 TODAY TOP3\n\n`;
  top3.forEach((job, i) => {
    md += `### ${i + 1}. ${job.title}\n\n`;
    md += `- URL: ${job.url}\n`;
    md += `- 報酬: ${job.price || '要確認'}\n`;
    md += `- ランク: **${job.rank}**\n`;
    md += `- AI実績: ${toStars(job.aiScore)}\n`;
    md += `- 応募理由: ${job.reason}\n\n`;
    md += `---\n\n`;
  });
  md += `## 全案件\n\n`;
  jobs.forEach((job, i) => {
    md += `## ${i + 1}. [${job.rank}] ${job.title}\n\nURL: ${job.url}\n報酬: ${job.price || '要確認'}\n応募理由: ${job.reason}\n\n---\n\n`;
  });
  return md;
}

module.exports = { renderHTML, renderMarkdown };
