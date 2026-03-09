/* ════════════════════════════════════════════════════════════════════════════
   SOW Analysis Dashboard — Application Logic
   ════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  scoreFilter: 'all',
  categoryFilter: 'all',
  search: '',
  gdocLinks: {},
  currentDocId: null
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadGdocLinks();
  renderStats();
  renderScoreChart();
  renderScoreLegend();
  renderCategoryFilter();
  renderDocuments();
  renderVendors();
  setupEventListeners();
});

// ─── Fetch gdoc_links.json ────────────────────────────────────────────────────
async function loadGdocLinks() {
  try {
    const res = await fetch('../gdoc_links.json');
    if (res.ok) {
      state.gdocLinks = await res.json();
    }
  } catch (e) {
    // Server not running or no links yet — fine, silently ignore
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats() {
  const readable  = SOW_DOCUMENTS.filter(d => d.readable).length;
  const withFixed = SOW_DOCUMENTS.filter(d => d.fixedLink).length;
  const avgScore  = (() => {
    const scored = SOW_DOCUMENTS.filter(d => d.score !== null);
    return scored.length ? (scored.reduce((s, d) => s + d.score, 0) / scored.length).toFixed(1) : 0;
  })();

  const stats = [
    { number: SOW_DOCUMENTS.length, label: 'סה"כ מסמכים', color: '#1e3a5f' },
    { number: readable,             label: 'מסמכים קריאים', color: '#15803d' },
    { number: withFixed,            label: 'גרסאות משופרות', color: '#4d7c0f' },
    { number: VENDOR_DATA.length,   label: 'ספקים שנחקרו', color: '#b45309' },
    { number: avgScore,             label: 'ציון ממוצע (מ-5)', color: '#1d4ed8' }
  ];

  document.getElementById('stats-grid').innerHTML = stats.map(s => `
    <div class="stat-card" style="border-top-color: ${s.color}">
      <div class="stat-number" style="color: ${s.color}">${s.number}</div>
      <div class="stat-label">${s.label}</div>
    </div>
  `).join('');
}

// ─── Score Chart ──────────────────────────────────────────────────────────────
function renderScoreChart() {
  const scoreCounts = [5,4,3,2,1].map(s =>
    SOW_DOCUMENTS.filter(d => d.score === s).length
  );
  const unreadable = SOW_DOCUMENTS.filter(d => d.score === null).length;

  const ctx = document.getElementById('scoreChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['מעולה (5)', 'טוב (4)', 'בינוני (3)', 'גרוע (2)', 'גרוע מאוד (1)', 'לא קריא'],
      datasets: [{
        label: 'מספר מסמכים',
        data: [...scoreCounts, unreadable],
        backgroundColor: ['#16a34a','#65a30d','#d97706','#ea580c','#dc2626','#6b7280'],
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            label: ctx => ` ${ctx.raw} מסמכים`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: 'rgba(0,0,0,.06)' }
        },
        y: {
          ticks: { font: { family: 'Segoe UI, Arial Hebrew, Arial, sans-serif', size: 12 } },
          grid: { display: false }
        }
      }
    }
  });
}

function renderScoreLegend() {
  const items = [
    { label: 'מעולה', color: '#16a34a' },
    { label: 'טוב',    color: '#65a30d' },
    { label: 'בינוני', color: '#d97706' },
    { label: 'גרוע',   color: '#ea580c' },
    { label: 'גרוע מאוד', color: '#dc2626' },
    { label: 'לא קריא', color: '#6b7280' }
  ];
  document.getElementById('score-legend').innerHTML = items.map(i => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${i.color}"></div>
      <span>${i.label}</span>
    </div>
  `).join('');
}

// ─── Category Filter ──────────────────────────────────────────────────────────
function renderCategoryFilter() {
  const sel = document.getElementById('category-filter');
  CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });
}

// ─── Document Grid ────────────────────────────────────────────────────────────
function getFilteredDocs() {
  return SOW_DOCUMENTS.filter(doc => {
    const scoreMatch = state.scoreFilter === 'all' ||
      (state.scoreFilter === 'null' ? doc.score === null : doc.score === parseInt(state.scoreFilter));
    const catMatch   = state.categoryFilter === 'all' || doc.category === state.categoryFilter;
    const search     = state.search.toLowerCase();
    const searchMatch = !search ||
      doc.fileName.toLowerCase().includes(search) ||
      doc.category.toLowerCase().includes(search) ||
      doc.rationale.toLowerCase().includes(search);
    return scoreMatch && catMatch && searchMatch;
  });
}

function renderDocuments() {
  const docs  = getFilteredDocs();
  const grid  = document.getElementById('doc-grid');
  const count = document.getElementById('doc-count');

  count.textContent = `מציג ${docs.length} מתוך ${SOW_DOCUMENTS.length} מסמכים`;

  if (docs.length === 0) {
    grid.innerHTML = `<div class="empty-state"><h3>לא נמצאו מסמכים</h3><p>שנה את הפילטרים ונסה שנית</p></div>`;
    return;
  }

  grid.innerHTML = docs.map(doc => {
    const scoreKey = doc.score === null ? 'null' : String(doc.score);
    const ratingClass = `rating-${doc.rating}`;
    const hasEncoding = doc.encodingIssues && doc.encodingIssues !== 'לא' && doc.encodingIssues !== 'לא רלוונטי';
    return `
      <div class="doc-card doc-card-score${scoreKey}" onclick="showModal(${doc.id})" tabindex="0" role="button"
           onkeydown="if(event.key==='Enter')showModal(${doc.id})">
        <div class="doc-card-header">
          <div class="doc-card-name">${escHtml(doc.fileName)}</div>
          <div class="score-badge badge-${scoreKey}">${doc.score !== null ? doc.score : '—'}</div>
        </div>
        <div class="doc-card-meta">
          <span class="tag tag-category">${escHtml(doc.category)}</span>
          ${doc.date !== 'לא ידוע' ? `<span class="tag tag-date">${escHtml(doc.date)}</span>` : ''}
          ${hasEncoding ? `<span class="tag tag-encoding">קידוד: ${escHtml(doc.encodingIssues)}</span>` : ''}
          ${!doc.readable ? `<span class="tag tag-unreadable">לא קריא (${escHtml(doc.formats)})</span>` : ''}
        </div>
        <div class="doc-card-rationale">${escHtml(doc.rationale)}</div>
        <div class="doc-card-footer">
          <span class="doc-rating-label ${ratingClass}">${escHtml(doc.rating)}</span>
          ${doc.fixedLink ? `<span class="doc-has-fixed">✅ גרסה משופרת</span>` : '<span></span>'}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Vendor Section ───────────────────────────────────────────────────────────
function renderVendors() {
  const container = document.getElementById('vendor-container');
  const grouped   = {};
  VENDOR_DATA.forEach(v => {
    if (!grouped[v.category]) grouped[v.category] = [];
    grouped[v.category].push(v);
  });

  container.innerHTML = Object.entries(grouped).map(([cat, vendors]) => `
    <div class="vendor-category-group">
      <div class="vendor-category-title">
        <span>${escHtml(cat)}</span>
        <span class="tag">${vendors.length} ספקים</span>
      </div>
      <div class="vendor-grid">
        ${vendors.map(v => renderVendorCard(v)).join('')}
      </div>
    </div>
  `).join('');
}

function renderVendorCard(v) {
  const color = SCORE_COLORS[v.feasibility] || SCORE_COLORS[null];
  const bg    = SCORE_BG[v.feasibility]     || SCORE_BG[null];
  const websiteHtml = v.website && v.website !== '—'
    ? `<a href="${escAttr(v.website)}" target="_blank" rel="noopener" class="vendor-website">🔗 ${escHtml(v.website.replace('https://', '').replace('http://', ''))}</a>`
    : '';
  return `
    <div class="vendor-card" style="border-top-color:${color}">
      <div class="vendor-card-header">
        <div class="vendor-name">${escHtml(v.vendor)}</div>
        <div class="feasibility-badge" style="background:${bg};color:${color};border:2px solid ${color}">${v.feasibility}</div>
      </div>
      <div class="vendor-country">📍 ${escHtml(v.country)}</div>
      ${websiteHtml}
      <span class="vendor-detail-label">ישימות עם SOW:</span>
      <div class="vendor-detail">${escHtml(v.feasibilityRationale)}</div>
      <span class="vendor-detail-label">מחסומים עיקריים:</span>
      <div class="vendor-detail">${escHtml(v.barriers)}</div>
      <span class="vendor-detail-label">המלצות לSOW:</span>
      <div class="vendor-detail">${escHtml(v.sowRecommendations)}</div>
    </div>
  `;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function showModal(docId) {
  const doc = SOW_DOCUMENTS.find(d => d.id === docId);
  if (!doc) return;
  state.currentDocId = docId;

  renderModalHeader(doc);
  renderAnalysisTab(doc);
  renderResearchTab(doc);
  renderVendorFeasibilityTab(doc);
  renderRecommendationsTab(doc);
  renderFixedDocTab(doc);

  // Reset to first tab
  setActiveTab('analysis');

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  state.currentDocId = null;
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function setActiveTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('tab-active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('tab-active', el.id === `tab-${tabName}`);
  });
}

function renderModalHeader(doc) {
  const scoreKey = doc.score === null ? 'null' : String(doc.score);
  document.getElementById('modal-header').innerHTML = `
    <div class="modal-header-top">
      <div class="modal-score-badge badge-${scoreKey}">${doc.score !== null ? doc.score : '—'}</div>
      <div style="flex:1">
        <div class="modal-doc-name">${escHtml(doc.fileName)}</div>
        <div class="modal-meta">
          <span class="tag tag-category">${escHtml(doc.category)}</span>
          <span class="tag tag-date">${escHtml(doc.date)}</span>
          <span class="tag">${escHtml(doc.formats)}</span>
          <span class="doc-rating-label rating-${doc.rating}">${escHtml(doc.rating)}</span>
        </div>
      </div>
    </div>
    <div class="vendor-detail" style="margin-top:.5rem">${escHtml(doc.rationale)}</div>
  `;
}

function renderAnalysisTab(doc) {
  const dims = doc.detailedAnalysis.split(' | ').map(d => {
    const colonIdx = d.indexOf(':');
    if (colonIdx === -1) return `<div class="dimension-item"><div class="dimension-text">${escHtml(d)}</div></div>`;
    const title = d.substring(0, colonIdx).trim();
    const text  = d.substring(colonIdx + 1).trim();
    return `
      <div class="dimension-item">
        <div class="dimension-title">${escHtml(title)}</div>
        <div class="dimension-text">${escHtml(text)}</div>
      </div>
    `;
  }).join('');
  document.getElementById('analysis-content').innerHTML = `<div class="dimension-list">${dims}</div>`;
}

function renderResearchTab(doc) {
  const html = marked.parse(doc.externalResearch || '—');
  document.getElementById('research-content').innerHTML = html;
}

function renderVendorFeasibilityTab(doc) {
  // Find matching vendor cards for this doc's category
  const categoryVendors = VENDOR_DATA.filter(v => {
    const docCat = doc.category.toLowerCase();
    const vCat   = v.category.toLowerCase();
    return docCat.includes(vCat.split(' ')[0]) || vCat.includes(docCat.split(' ')[0]) ||
           docCat === vCat;
  });

  let html = `<div class="vendor-detail" style="margin-bottom:1rem">${escHtml(doc.vendorFeasibility)}</div>`;

  if (categoryVendors.length > 0) {
    html += `<h4 style="margin-bottom:.75rem;color:var(--navy)">ספקים בקטגוריה זו:</h4>`;
    html += `<div class="vendor-grid">${categoryVendors.map(v => renderVendorCard(v)).join('')}</div>`;
  }

  document.getElementById('vendor-feasibility-content').innerHTML = html;
}

function renderRecommendationsTab(doc) {
  const rawRecs = doc.recommendations;
  // Parse P1/P2/P3 sections
  const p1Match = rawRecs.match(/P1[^|]*((?:\|(?!P[23])[^|]*)*)/);
  const p2Match = rawRecs.match(/P2[^|]*((?:\|(?!P[13])[^|]*)*)/);
  const p3Match = rawRecs.match(/P3[^|]*((?:\|(?!P[12])[^|]*)*)/);

  function parseGroup(match, priority, label) {
    if (!match) return '';
    const raw   = match[0];
    const items = raw.split('|').map(s => s.trim()).filter(Boolean);
    const listItems = items.map(i => {
      // Strip the P prefix label from first item
      const text = i.replace(/^P\d+\s*\([^)]+\):\s*/, '');
      return text ? `<div class="rec-item">${escHtml(text)}</div>` : '';
    }).filter(Boolean).join('');
    return `
      <div class="rec-group rec-${priority}">
        <div class="rec-group-title">${label}</div>
        ${listItems}
      </div>
    `;
  }

  const html = parseGroup(p1Match, 'p1', '🔴 P1 — פעולות קריטיות (חובה לתקן)') +
               parseGroup(p2Match, 'p2', '🟠 P2 — שיפורים חשובים') +
               parseGroup(p3Match, 'p3', '🔵 P3 — המלצות מועדפות');

  document.getElementById('recommendations-content').innerHTML = html ||
    `<div class="vendor-detail">${escHtml(rawRecs)}</div>`;
}

// ─── Fixed Doc Viewer ─────────────────────────────────────────────────────────
function renderFixedDocTab(doc) {
  const actionsEl  = document.getElementById('fixed-doc-actions');
  const contentEl  = document.getElementById('fixed-doc-content');

  if (!doc.fixedLink) {
    actionsEl.innerHTML = `<span class="vendor-detail">אין גרסה משופרת עבור מסמך זה (קובץ לא קריא)</span>`;
    contentEl.innerHTML = '';
    return;
  }

  const gdocUrl = state.gdocLinks[doc.fileName] || state.gdocLinks[doc.fixedLink] || null;

  actionsEl.innerHTML = `
    <button class="btn btn-primary" onclick="loadFixedDoc(${doc.id})">📄 טען מסמך משופר</button>
    ${gdocUrl
      ? `<a href="${escAttr(gdocUrl)}" target="_blank" rel="noopener" class="btn btn-gdoc">📝 פתח ב-Google Doc</a>`
      : `<button class="btn btn-gdoc-pending" title="הרץ create_gdocs.py להפקת Google Doc">📝 Google Doc — לא נוצר עדיין</button>`
    }
    <a href="../${escAttr(doc.fixedLink)}" target="_blank" class="btn btn-outline">⬇️ קובץ MD</a>
  `;
  contentEl.innerHTML = `<div class="loading-text">לחץ על "טען מסמך משופר" לקריאת המסמך</div>`;
}

async function loadFixedDoc(docId) {
  const doc     = SOW_DOCUMENTS.find(d => d.id === docId);
  if (!doc || !doc.fixedLink) return;

  const contentEl = document.getElementById('fixed-doc-content');
  contentEl.innerHTML = `<div class="loading-text">טוען מסמך...</div>`;

  try {
    const url = `../${doc.fixedLink}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mdText = await res.text();
    contentEl.innerHTML = marked.parse(mdText);
    // Add a refresh button for the GDoc link in case it was just created
    await loadGdocLinks();
    renderFixedDocTab(doc);
    document.getElementById('fixed-doc-content').innerHTML = marked.parse(mdText);
  } catch (e) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <h3>לא ניתן לטעון את המסמך</h3>
        <p>ודא שהשרת פועל: <code>python start_server.py</code> בתיקיית data/SOW/</p>
        <p style="margin-top:.5rem">שגיאה: ${escHtml(e.message)}</p>
      </div>
    `;
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Score filter chips
  document.getElementById('score-filters').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    document.querySelectorAll('#score-filters .chip').forEach(c => c.classList.remove('chip-active'));
    btn.classList.add('chip-active');
    state.scoreFilter = btn.dataset.score;
    renderDocuments();
  });

  // Category filter
  document.getElementById('category-filter').addEventListener('change', e => {
    state.categoryFilter = e.target.value;
    renderDocuments();
  });

  // Search
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      renderDocuments();
    }, 220);
  });

  // Modal tab buttons
  document.getElementById('modal-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    setActiveTab(btn.dataset.tab);
  });

  // Escape key to close modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return escHtml(str);
}
