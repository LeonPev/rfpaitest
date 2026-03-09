'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  screen: 'chat',
  // Dashboard
  scoreFilter: 'all', categoryFilter: 'all', search: '',
  gdocLinks: {},
  // Chat + docs
  allDocs: [],
  selectedPaths: [],
  chatHistory: [],
  proposedPrompt: null,
  readyToGenerate: false,
  chatBusy: false,
  sidebarFilter: '',
  // Thinking / Results
  sessionId: null,
  projectId: null,
  result: null,
  activeDocTab: null,
  issueSeverity: 'all',
  // Projects
  projects: [],
  projectFilter: 'all',
  renameProjectId: null,
};

// ─── Global references ────────────────────────────────────────────────────────
let currentEventSource = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Dashboard data if available
  if (typeof SOW_DOCUMENTS !== 'undefined') {
    renderStats();
    renderScoreChart();
    renderScoreLegend();
    renderScoreFilterChips();
    renderCategoryFilter();
    renderDocuments();
    renderVendors();
  }
  loadGdocLinks();

  // Global event listeners
  document.addEventListener('click', e => {
    if (!e.target.closest('.results-header-wrap')) hideExportMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeRenameModal(); } });

  // Chat input
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 96) + 'px';
    });
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
  }

  // Load docs for sidebar and start initial analysis
  fetchBrowserDocs().then(() => {
    renderSidebarDocs();
    loadInitialAnalysis();
  });

  // Auto-save on beforeunload
  window.addEventListener('beforeunload', () => {
    if (state.sessionId && state.result) {
      saveSessionAsProject();
    }
  });
});

// ─── Screen Navigation ────────────────────────────────────────────────────────
function showScreen(name) {
  ['chat', 'projects', 'dashboard', 'analytics', 'thinking', 'results'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  });
  state.screen = name;
  window.scrollTo(0, 0);

  // Nav active state
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-link[onclick*="'${name}'"]`);
  if (activeLink) activeLink.classList.add('active');

  if (name === 'projects') loadProjects();
  if (name === 'analytics') loadAnalytics();
}

// ─── GDoc links ───────────────────────────────────────────────────────────────
async function loadGdocLinks() {
  try {
    const r = await fetch('/data/SOW/gdoc_links.json');
    if (r.ok) state.gdocLinks = await r.json();
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════════════════════
// SIDEBAR — File Browser
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchBrowserDocs() {
  try {
    const res = await fetch('/api/docs');
    state.allDocs = await res.json();
  } catch (_) {}
}

function renderSidebarDocs() {
  const container = document.getElementById('sidebar-doc-list');
  if (!container) return;
  const docs = filterDocs(state.allDocs, state.sidebarFilter);

  if (!docs.length) {
    container.innerHTML = '<div class="sidebar-empty">לא נמצאו מסמכים</div>';
    return;
  }

  // Group by category
  const groups = {};
  docs.forEach(d => {
    const cat = d.category || 'אחר';
    (groups[cat] = groups[cat] || []).push(d);
  });

  container.innerHTML = Object.entries(groups).map(([cat, catDocs]) => `
    <div class="sidebar-cat-group">
      <div class="sidebar-cat-title">${esc(cat)} (${catDocs.length})</div>
      ${catDocs.map(d => {
        const selected = state.selectedPaths.includes(d.path);
        return `
          <div class="sidebar-doc-item${selected ? ' selected' : ''}" data-path="${esc(d.path)}"
               onclick="toggleDocSelection(this)">
            <div class="sidebar-doc-icon">${_extIcon(d.ext)}</div>
            <div class="sidebar-doc-info">
              <div class="sidebar-doc-name">${esc(d.name)}</div>
              <div class="sidebar-doc-meta">${d.ext} · ${d.size_kb}KB</div>
            </div>
            <div class="sidebar-doc-check">${selected ? '✓' : ''}</div>
          </div>`;
      }).join('')}
    </div>`).join('');
}

function _extIcon(ext) {
  const icons = { '.pdf': '📄', '.docx': '📝', '.doc': '📋', '.xlsx': '📊', '.txt': '📃', '.md': '📑' };
  return icons[ext] || '📎';
}

function filterDocs(docs, query) {
  if (!query) return docs;
  const q = query.toLowerCase();
  return docs.filter(d => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q));
}

function filterSidebarDocs(query) {
  state.sidebarFilter = query;
  renderSidebarDocs();
}

function toggleDocSelection(el) {
  const path = el.dataset.path;
  if (!path || !path.trim()) return;
  const idx = state.selectedPaths.indexOf(path);
  if (idx >= 0) {
    state.selectedPaths.splice(idx, 1);
    el.classList.remove('selected');
    el.querySelector('.sidebar-doc-check').textContent = '';
  } else {
    state.selectedPaths.push(path);
    el.classList.add('selected');
    el.querySelector('.sidebar-doc-check').textContent = '✓';
  }
  updateSelectedPanel();
  updateRunButton();
}

function clearSelectedFiles() {
  state.selectedPaths = [];
  renderSidebarDocs();
  updateSelectedPanel();
  updateRunButton();
}

function updateSelectedPanel() {
  const count = document.getElementById('selected-count');
  const chips = document.getElementById('sidebar-selected-chips');
  if (count) count.textContent = state.selectedPaths.length;
  if (!chips) return;

  if (state.selectedPaths.length === 0) {
    chips.innerHTML = '';
    return;
  }
  chips.innerHTML = state.selectedPaths.map((p, i) => {
    const name = p.split(/[/\\]/).pop();
    return `<div class="file-chip">${esc(name)}<button class="file-chip-remove" onclick="removePathByIdx(${i})">✕</button></div>`;
  }).join('');
}

function removePathByIdx(idx) {
  state.selectedPaths.splice(idx, 1);
  renderSidebarDocs();
  updateSelectedPanel();
  updateRunButton();
}

function updateRunButton() {
  // btn-generate removed — generation triggered via chat bubble or auto-trigger
}


// ═══════════════════════════════════════════════════════════════════════════════
// INITIAL ANALYSIS — Dynamic First Message
// ═══════════════════════════════════════════════════════════════════════════════

async function loadInitialAnalysis() {
  const loading = document.getElementById('initial-loading');
  if (loading) loading.remove();

  const html = `
    <div class="initial-greeting">שלום דנה! ברוכה הבאה למערכת רכש חכם.</div>
    <div class="initial-summary">
      תוכלי לבקש שאציע קבצים רלוונטיים, לתאר את הצורך שלך,
      או לבחור קבצים מהסרגל הצדדי ולשאול שאלה.
    </div>`;
  addChatBubble(html, 'assistant', true);
}

function selectFileByName(name) {
  const doc = state.allDocs.find(d => d.name.includes(name) || name.includes(d.name));
  if (doc && !state.selectedPaths.includes(doc.path)) {
    state.selectedPaths.push(doc.path);
    renderSidebarDocs();
    updateSelectedPanel();
    updateRunButton();
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// CHAT — AI Conversation
// ═══════════════════════════════════════════════════════════════════════════════

async function sendChatMessage() {
  if (state.chatBusy) return;
  const input = document.getElementById('chat-input');
  const query = input.value.trim();
  if (!query) return;

  state.chatBusy = true;
  addChatBubble(query, 'user');
  state.chatHistory.push({ role: 'user', content: query });
  input.value = '';
  input.style.height = 'auto';

  // ── Fast path: files already selected → skip chat, go straight to pipeline ──
  if (state.selectedPaths.length > 0) {
    state.proposedPrompt = query;
    state.chatBusy = false;
    startGeneration();
    return;
  }

  const thinkingBubble = addChatBubble('<div class="typing-indicator"><span></span><span></span><span></span></div>חושב...', 'assistant', true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query, history: state.chatHistory, selected_files: state.selectedPaths }),
    });
    const data = await res.json();
    if (thinkingBubble) thinkingBubble.remove();

    if (data.error) {
      addChatBubble(`שגיאה: ${data.error}`, 'assistant');
      state.chatBusy = false;
      return;
    }

    state.chatHistory.push({ role: 'assistant', content: data.message });
    let html = esc(data.message).replace(/\n/g, '<br>');

    // Show recommended files
    if (data.recommended_files && data.recommended_files.length > 0) {
      html += '<div class="chat-suggestions">';
      data.recommended_files.forEach(f => {
        const already = state.selectedPaths.includes(f.path);
        html += `
          <div class="suggestion-item${already ? ' added' : ''}"
               data-path="${esc(f.path)}" onclick="addSuggestion(this)">
            <span>${already ? '✓' : '+'}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
            ${f.reason ? `<span class="suggestion-reason">${esc(f.reason)}</span>` : ''}
          </div>`;
      });
      html += '</div>';
    }

    // Show suggested actions — store in state to avoid inline JS escaping issues
    if (data.suggested_actions && data.suggested_actions.length > 0) {
      state._currentActions = data.suggested_actions;
      html += '<div class="action-suggestions">';
      html += '<div class="action-suggestions-title">פעולות מומלצות:</div>';
      data.suggested_actions.forEach((a, idx) => {
        html += `<button class="action-suggestion-btn" onclick="executeActionByIdx(${idx})">
          <span class="action-suggestion-icon">${_actionIcon(a.type)}</span>
          <span class="action-suggestion-label">${esc(a.label)}</span>
        </button>`;
      });
      html += '</div>';
    }

    // Show proposed prompt (unless auto_start flag is set)
    if (data.proposed_prompt && !data.auto_start) {
      state.proposedPrompt = data.proposed_prompt;
      html += `<div class="proposed-prompt-box">
        <div class="proposed-prompt-label">הצעת ביצוע:</div>
        <div class="proposed-prompt-text">${esc(data.proposed_prompt)}</div>
        <button class="btn-grad btn-sm" onclick="startGeneration()" style="margin-top:.5rem">בצע עכשיו</button>
      </div>`;
    }

    addChatBubble(html, 'assistant', true);

    if (data.ready_to_generate) {
      state.readyToGenerate = true;
      // Store context for pipeline
      if (data.proposed_prompt) {
        state.proposedPrompt = data.proposed_prompt;
      } else if (data.context) {
        state.proposedPrompt = data.context;
      }

      if (data.recommended_files) {
        data.recommended_files.forEach(f => {
          if (f.path && !state.selectedPaths.includes(f.path)) {
            state.selectedPaths.push(f.path);
          }
        });
      }
      renderSidebarDocs();
      updateSelectedPanel();
      updateRunButton();

      // Auto-start if: (1) no proposed_prompt to confirm, OR (2) auto_start flag is true
      if (!data.proposed_prompt || data.auto_start) {
        setTimeout(() => startGeneration(), 400);
      }
    }

  } catch (e) {
    if (thinkingBubble) thinkingBubble.remove();
    addChatBubble(`שגיאה בתקשורת: ${e.message}`, 'assistant');
  }
  state.chatBusy = false;
}

function _actionIcon(type) {
  const icons = {
    'sow_update': '📝',
    'research': '🔍',
    'analysis': '📊',
    'comparison': '⚖️',
  };
  return icons[type] || '✨';
}

function executeActionByIdx(idx) {
  const a = (state._currentActions || [])[idx];
  if (!a) return;
  const input = document.getElementById('chat-input');
  input.value = `${a.label}: ${a.description}`;
  sendChatMessage();
}

function addChatBubble(content, role, isHtml = false) {
  const messages = document.getElementById('chat-messages');
  if (!messages) return null;
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  if (isHtml) div.innerHTML = content;
  else div.textContent = content;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function addSuggestion(el) {
  if (el.classList.contains('added')) return;
  const path = el.dataset.path;
  el.classList.add('added');
  el.querySelector('span').textContent = '✓';

  if (!state.selectedPaths.includes(path)) {
    state.selectedPaths.push(path);
    renderSidebarDocs();
    updateSelectedPanel();
    updateRunButton();
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

async function startGeneration() {
  // Filter out empty/invalid paths
  state.selectedPaths = state.selectedPaths.filter(p => p && p.trim());
  if (state.selectedPaths.length === 0) return;

  const context = state.proposedPrompt || '';
  addChatBubble('מתחיל יצירת מסמך...', 'assistant');

  // Create project first
  try {
    const projRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.proposedPrompt ? state.proposedPrompt.substring(0, 50) : 'פרויקט חדש',
        file_paths: state.selectedPaths,
        context,
        chat_history: state.chatHistory,
      }),
    });
    const project = await projRes.json();
    state.projectId = project.id;
  } catch (_) {}

  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_paths: state.selectedPaths,
        context,
        sub_type: 'כללי',
        project_id: state.projectId,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.sessionId = data.session_id;
    showScreen('thinking');
    startSSEStream(data.session_id);
  } catch (e) {
    addChatBubble(`שגיאה: ${e.message}`, 'assistant');
  }
}

function stopGeneration() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  addChatBubble('נוצר ה-עיבוד.', 'assistant');
  showScreen('chat');
}


// ═══════════════════════════════════════════════════════════════════════════════
// THINKING SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_PROGRESS = { orchestrator: 10, domain_expert: 50, legal: 85 };
let progressValue = 0;

function startSSEStream(sessionId) {
  resetThinkingScreen();
  const evtSource = new EventSource(`/api/stream/${sessionId}`);
  currentEventSource = evtSource;

  evtSource.onmessage = e => {
    const data = JSON.parse(e.data);

    if (data.type === 'error') {
      evtSource.close();
      addActivityLog('error', data.msg || 'שגיאה לא ידועה');
      return;
    }

    if (data.type === 'complete') {
      evtSource.close();
      setProgress(100);
      addActivityLog('done', 'העיבוד הושלם — מכין תוצאות...');
      setTimeout(() => {
        state.result = data.result;
        renderResultView(data.result);
        showScreen('results');
        updateRunButton();
      }, 800);
      return;
    }

    updateAgentCard(data);
    addAgentLog(data.agent, data.msg);
    addActivityLog(data.status, `[${_agentLabel(data.agent)}] ${data.msg || ''}`);

    const pct = AGENT_PROGRESS[data.agent] || progressValue;
    if (data.status === 'done') setProgress(Math.max(progressValue, pct + 10));
    else if (pct > progressValue) setProgress(pct);
  };

  evtSource.onerror = () => {
    evtSource.close();
    addActivityLog('warning', 'החיבור נותק — בודק תוצאות...');
    setTimeout(() => fetchSessionResult(sessionId), 2000);
  };
}

function resetThinkingScreen() {
  progressValue = 0;
  setProgress(0);
  ['orchestrator', 'domain_expert', 'legal'].forEach(a => {
    const card = document.getElementById(`agent-${a}`);
    const msg  = document.getElementById(`msg-${a}`);
    const st   = document.getElementById(`status-${a}`);
    const log  = document.getElementById(`log-${a}`);
    if (card) card.className = 'gc agent-card';
    if (msg) msg.textContent = 'ממתין...';
    if (st) st.textContent = '⏳';
    if (log) log.innerHTML = '';
  });
  const logBody = document.getElementById('activity-log-body');
  if (logBody) logBody.innerHTML = '';
}

function setProgress(pct) {
  progressValue = pct;
  const bar   = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  if (bar) bar.style.width = `${pct}%`;
  if (label) label.textContent = pct < 100 ? `${Math.round(pct)}% הושלם` : 'הושלם! טוען תוצאות...';
}

function updateAgentCard(data) {
  const card = document.getElementById(`agent-${data.agent}`);
  const msg  = document.getElementById(`msg-${data.agent}`);
  const st   = document.getElementById(`status-${data.agent}`);
  if (!card) return;
  if (msg) msg.textContent = data.msg || '';
  card.classList.remove('running', 'done', 'error', 'warning');
  if (data.status === 'running') {
    card.classList.add('running');
    if (st) st.innerHTML = '<span class="spinner"></span>';
  } else if (data.status === 'done') {
    card.classList.add('done');
    if (st) st.textContent = '✅';
  } else if (data.status === 'error') {
    card.classList.add('error');
    if (st) st.textContent = '❌';
  } else if (data.status === 'warning') {
    card.classList.add('warning');
    if (st) st.textContent = '⚠️';
  }
}

function addAgentLog(agent, msg) {
  const log = document.getElementById(`log-${agent}`);
  if (!log || !msg) return;
  const line = document.createElement('div');
  line.className = 'agent-log-line';
  line.innerHTML = `<div class="agent-log-dot"></div><span>${esc(msg)}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function addActivityLog(status, msg) {
  const logBody = document.getElementById('activity-log-body');
  if (!logBody) return;
  const time = new Date().toLocaleTimeString('he-IL', { hour12: false });
  const icon = status === 'done' ? '✅' : status === 'error' ? '❌' : status === 'warning' ? '⚠️' : '•';
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-icon">${icon}</span><span class="log-text">${esc(msg)}</span>`;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
}

function _agentLabel(key) {
  return { orchestrator: 'מתזמן', domain_expert: 'מומחה תחום', legal: 'משפטי + שוק' }[key] || key;
}

async function fetchSessionResult(sessionId) {
  try {
    const r = await fetch(`/api/session/${sessionId}`);
    const d = await r.json();
    if (d.result) { state.result = d.result; renderResultView(d.result); showScreen('results'); }
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function renderResultView(result) {
  const docs       = result.documents || [];
  const market     = result.market_analysis || {};
  const challenges = market.challenges || [];
  const thr        = result.threshold_summary || {};

  document.getElementById('results-title').textContent = result.tender_title || 'מסמכים מוכנים';
  document.getElementById('results-badge').textContent  = result.sub_type || 'הופק ב-AI';

  const totalItems = docs.reduce((n, d) => n + (d.sections || []).length + (d.qa_items || []).length, 0);
  document.getElementById('results-meta').textContent =
    `${docs.length} מסמכים | ${totalItems} סעיפים | ${thr.hard || 0} סף קשה | ${challenges.length} אתגרים`;

  const tabsBar  = document.getElementById('doc-tabs-bar');
  const tabsBody = document.getElementById('doc-tabs-body');
  tabsBar.innerHTML  = '';
  tabsBody.innerHTML = '';

  const tabs = [
    ...docs.map(doc => ({
      id: doc.id,
      label: _docTypeLabel(doc.type),
      count: (doc.sections || doc.qa_items || []).length,
      render: () => _renderDocTab(doc, thr),
    })),
  ];
  if (challenges.length > 0) {
    tabs.push({ id: 'tab-issues', label: 'אתגרים', count: challenges.length,
      render: () => _renderIssuesTab(challenges) });
  }
  if ((market.vendors || []).length > 0) {
    tabs.push({ id: 'tab-market', label: 'שוק', count: (market.vendors || []).length,
      render: () => _renderMarketTab(market) });
  }

  tabs.forEach((tab, idx) => {
    const btn = document.createElement('button');
    btn.className = `doc-tab-btn${idx === 0 ? ' active' : ''}`;
    btn.id = `tab-btn-${tab.id}`;
    btn.innerHTML = `${esc(tab.label)} <span class="doc-tab-count">${tab.count}</span>`;
    btn.addEventListener('click', () => switchDocTab(tab.id));
    tabsBar.appendChild(btn);

    const div = document.createElement('div');
    div.className = `doc-tab-content${idx === 0 ? ' active' : ''}`;
    div.id = `tabpanel-${tab.id}`;
    div.innerHTML = tab.render();
    tabsBody.appendChild(div);
  });
  state.activeDocTab = tabs[0]?.id || null;
}

function _docTypeLabel(type) {
  return { sow: 'SOW', vendor_qa: 'שאלות ספקים', security_appendix: 'אבטחה' }[type] || type;
}

function switchDocTab(tabId) {
  state.activeDocTab = tabId;
  document.querySelectorAll('.doc-tab-btn').forEach(b =>
    b.classList.toggle('active', b.id === `tab-btn-${tabId}`));
  document.querySelectorAll('.doc-tab-content').forEach(d =>
    d.classList.toggle('active', d.id === `tabpanel-${tabId}`));
}

function _renderDocTab(doc, thr) {
  if (doc.type === 'vendor_qa') return _renderQADoc(doc);
  const sections = doc.sections || [];
  const modified  = sections.filter(s => s.change_type === 'modified').length;
  const added     = sections.filter(s => s.change_type === 'added').length;
  const unchanged = sections.filter(s => s.change_type === 'unchanged').length;

  const filterBar = `
    <div class="sow-filter-row">
      <span class="filter-label">סינון:</span>
      <div class="sow-filter-chips" id="sow-chips-${doc.id}">
        <button class="chip chip-active" data-change="all" onclick="setSowFilter('${doc.id}','all')">הכל (${sections.length})</button>
        <button class="chip" data-change="modified" onclick="setSowFilter('${doc.id}','modified')">שונה (${modified})</button>
        <button class="chip" data-change="added" onclick="setSowFilter('${doc.id}','added')">חדש (${added})</button>
        <button class="chip" data-change="unchanged" onclick="setSowFilter('${doc.id}','unchanged')">ללא שינוי (${unchanged})</button>
      </div>
    </div>`;

  const cards = sections.map(s => _renderSectionCard(s)).join('');
  return `${filterBar}<div id="sections-${doc.id}">${cards}</div>`;
}

function setSowFilter(docId, change) {
  const chips = document.getElementById(`sow-chips-${docId}`);
  chips?.querySelectorAll('.chip').forEach(c =>
    c.classList.toggle('chip-active', c.dataset.change === change));
  const container = document.getElementById(`sections-${docId}`);
  if (!container) return;
  container.querySelectorAll('.section-card').forEach(card => {
    card.style.display = (change === 'all' || card.dataset.change === change) ? '' : 'none';
  });
}

function _renderSectionCard(s) {
  const changeLabel = { added: 'חדש', modified: 'שונה', unchanged: 'ללא שינוי' };
  const changeBadge = { added: 'badge-added', modified: 'badge-modified', unchanged: 'badge-unchanged' };
  const riskBadge   = { high: 'badge-risk-high', medium: 'badge-risk-med', low: 'badge-risk-low' };
  const sid = esc(s.id);

  const statusBadge = s.status === 'accept' ? '<span class="badge-pill badge-accept">אושר</span>' :
                      s.status === 'reject' ? '<span class="badge-pill badge-reject">נדחה</span>' : '';

  return `
    <div class="section-card" id="card-${sid}" data-change="${esc(s.change_type || '')}">
      <div class="section-card-header" onclick="toggleSection('${sid}')">
        <div class="sec-num">${esc(s.number || '')}</div>
        <div class="sec-title-wrap">
          <div class="sec-title">${esc(s.title || '')}</div>
          ${s.change_reason ? `<div class="sec-reason">${esc(s.change_reason)}</div>` : ''}
        </div>
        <div class="sec-badges">
          ${s.change_type ? `<span class="badge-pill ${changeBadge[s.change_type] || ''}">${changeLabel[s.change_type] || ''}</span>` : ''}
          ${s.risk_level && s.risk_level !== 'low' ? `<span class="badge-pill ${riskBadge[s.risk_level] || ''}">${s.risk_level === 'high' ? 'סיכון גבוה' : 'סיכון בינוני'}</span>` : ''}
          ${statusBadge}
        </div>
        <span class="sec-chevron">▼</span>
      </div>
      <div class="section-card-body">
        ${s.original ? `
          <div class="diff-row">
            <div class="diff-box original">
              <span class="diff-box-label">מקורי</span>
              ${esc(s.original)}
            </div>
            <div class="diff-box updated">
              <span class="diff-box-label">מעודכן (2026)</span>
              <span id="text-${sid}">${esc(s.updated || '')}</span>
            </div>
          </div>` : `
          <div class="diff-row">
            <div class="diff-box new-only">
              <span class="diff-box-label">סעיף חדש</span>
              <span id="text-${sid}">${esc(s.updated || '')}</span>
            </div>
          </div>`}
        <div class="section-actions">
          <button class="btn-sec btn-sec-accept${s.status === 'accept' ? ' active' : ''}"
            onclick="event.stopPropagation();sectionAction('${sid}','accept')">✓ אשר</button>
          <button class="btn-sec btn-sec-reject${s.status === 'reject' ? ' active' : ''}"
            onclick="event.stopPropagation();sectionAction('${sid}','reject')">✗ דחה</button>
          <button class="btn-sec btn-sec-feedback"
            onclick="event.stopPropagation();toggleFeedback('${sid}')">משוב</button>
          <button class="btn-compare" onclick="event.stopPropagation();toggleCompare('${sid}')">השוואה מלאה</button>
        </div>
        <div class="feedback-box" id="fb-${sid}">
          <textarea class="feedback-textarea" id="fb-text-${sid}" rows="2"
            placeholder="ספק משוב על סעיף זה..." onclick="event.stopPropagation()"></textarea>
          <div class="feedback-actions">
            <button class="btn-feedback-send" onclick="event.stopPropagation();sendFeedback('${sid}')">שלח</button>
            <button class="btn-feedback-cancel" onclick="event.stopPropagation();toggleFeedback('${sid}')">ביטול</button>
          </div>
        </div>
        <div class="compare-panel" id="cmp-${sid}">
          <div class="compare-panel-header">
            <div class="compare-col-label">מקורי</div>
            <div class="compare-col-label">מעודכן (2026)</div>
          </div>
          <div class="compare-content">
            <div class="compare-original">${esc(s.original || '(אין מקור — סעיף חדש)')}</div>
            <div class="compare-updated">${esc(s.updated || '')}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function toggleSection(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle('expanded');
}

function toggleCompare(sectionId) {
  const panel = document.getElementById(`cmp-${sectionId}`);
  const btn = document.querySelector(`#card-${sectionId} .btn-compare`);
  panel?.classList.toggle('open');
  btn?.classList.toggle('active');
}

function _renderQADoc(doc) {
  const items = doc.qa_items || [];
  if (!items.length) return '<div class="empty-state"><h3>אין שאלות</h3></div>';
  return `<div class="qa-list">${items.map(q => `
    <div class="qa-card" onclick="this.classList.toggle('expanded')">
      <div class="qa-card-header">
        <div class="qa-q-icon">❓</div>
        <div style="flex:1;min-width:0">
          <div class="qa-question">${esc(q.question || '')}</div>
          <div class="qa-meta">
            <span class="qa-impact-${q.vendor_impact === 'high' ? 'high' : q.vendor_impact === 'medium' ? 'med' : 'low'}">
              ${q.vendor_impact === 'high' ? 'השפעה גבוהה' : q.vendor_impact === 'medium' ? 'השפעה בינונית' : 'השפעה נמוכה'}
            </span>
            ${q.category ? `<span class="qa-category-pill">${esc(q.category)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="qa-answer-wrap">
        <div class="qa-answer-label">תשובה</div>
        <div class="qa-answer-text">${esc(q.answer || '')}</div>
      </div>
    </div>`).join('')}</div>`;
}

function _renderIssuesTab(challenges) {
  if (!challenges.length) return '<div class="empty-state"><h3>לא זוהו אתגרים</h3></div>';
  const sorted = [...challenges].sort((a, b) => {
    const o = { critical: 0, high: 1, medium: 2, low: 3 };
    return (o[a.severity] ?? 9) - (o[b.severity] ?? 9);
  });
  return `<div class="issue-grid">${sorted.map(ch => `
    <div class="issue-card sev-${ch.severity}">
      <div class="issue-header">
        <div class="issue-title">${esc(ch.title || '')}</div>
        <div class="issue-badges">
          <span class="sev-pill-${ch.severity}">${_sevLabel(ch.severity)}</span>
          ${ch.must_have ? '<span class="must-have-pill">חובה</span>' : ''}
        </div>
      </div>
      <div class="issue-desc">${esc(ch.description || '')}</div>
      ${ch.recommendation ? `<div class="issue-rec">${esc(ch.recommendation)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function _sevLabel(sev) {
  return { critical: 'קריטי', high: 'גבוה', medium: 'בינוני', low: 'נמוך' }[sev] || sev;
}

function _renderMarketTab(market) {
  const vendors = market.vendors || [];
  const summary = market.summary || '';
  const summaryHtml = summary ? `<div class="market-summary-box">${esc(summary)}</div>` : '';
  const vendorCards = vendors.map(v => {
    const dots = [1,2,3,4,5].map(i => `<div class="mvc-fit-dot${i <= v.fit_score ? ' on' : ''}"></div>`).join('');
    const statusLabel = { qualified: 'כשיר', conditional: 'מותנה', disqualified: 'פסול' };
    return `
      <div class="market-vendor-card">
        <div class="mvc-header">
          <div class="mvc-name">${esc(v.name || '')}</div>
          <div class="mvc-fit">${dots}</div>
        </div>
        <div class="mvc-country">${esc(v.country || '')}</div>
        <div class="mvc-detail-label">חוזקות</div>
        <div class="mvc-detail-text">${esc(v.strengths || '')}</div>
        <div class="mvc-detail-label">חסמים</div>
        <div class="mvc-detail-text">${esc(v.barriers || '')}</div>
        <div class="mvc-status-row">
          <span class="mvc-status status-${v.status || 'conditional'}">${statusLabel[v.status] || v.status}</span>
        </div>
      </div>`;
  }).join('');
  return `${summaryHtml}<div class="market-grid">${vendorCards}</div>`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION ACTIONS — with feedback tracking
// ═══════════════════════════════════════════════════════════════════════════════

async function sectionAction(sectionId, action) {
  for (const doc of (state.result?.documents || [])) {
    const s = (doc.sections || []).find(s => s.id === sectionId);
    if (s) { s.status = action; break; }
  }

  const card = document.getElementById(`card-${sectionId}`);
  if (card) {
    card.querySelectorAll('.btn-sec-accept,.btn-sec-reject').forEach(b => b.classList.remove('active'));
    const activeBtn = card.querySelector(action === 'accept' ? '.btn-sec-accept' : '.btn-sec-reject');
    if (activeBtn) activeBtn.classList.add('active');
  }

  if (state.sessionId) {
    fetch('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: state.sessionId,
        project_id: state.projectId,
        id: sectionId,
        action,
      }),
    }).catch(() => {});
  }
}

function toggleFeedback(sectionId) {
  const fb = document.getElementById(`fb-${sectionId}`);
  if (fb) fb.classList.toggle('open');
}

async function sendFeedback(sectionId) {
  const ta   = document.getElementById(`fb-text-${sectionId}`);
  const text = ta?.value?.trim();
  if (!text) return;

  if (state.sessionId) {
    await fetch('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: state.sessionId,
        project_id: state.projectId,
        id: sectionId,
        action: 'edit',
        text,
      }),
    }).catch(() => {});
  }
  ta.value = '';
  toggleFeedback(sectionId);
}

async function acceptAll() {
  if (!state.result) return;
  for (const doc of (state.result.documents || [])) {
    for (const s of [...(doc.sections || []), ...(doc.qa_items || [])]) {
      if (s.status === 'pending') s.status = 'accept';
    }
  }
  document.querySelectorAll('.section-card .btn-sec-accept').forEach(b => b.classList.add('active'));

  if (state.sessionId) {
    await fetch('/api/accept-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, project_id: state.projectId }),
    }).catch(() => {});
  }

  // Show success message in chat
  addChatBubble('כל הסעיפים אושרו בהצלחה! ניתן לייצא את המסמך כ-MD או PDF.', 'assistant');
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

function toggleExportMenu() {
  document.getElementById('export-menu')?.classList.toggle('hidden');
}
function hideExportMenu() {
  document.getElementById('export-menu')?.classList.add('hidden');
}

async function exportMD() {
  hideExportMenu();
  if (!state.sessionId) return;
  try {
    const r = await fetch(`/api/export-markdown/${state.sessionId}`);
    const data = await r.json();
    const blob = new Blob([data.content], {type: 'text/markdown; charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.filename || 'SOW_export.md';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error('MD export error:', e);
  }
}

function exportPDF() {
  hideExportMenu();
  if (!state.sessionId) return;
  const a = document.createElement('a');
  a.href = `/api/export/pdf/${state.sessionId}`;
  a.download = 'SOW_IDF_2026.html';
  a.click();
}

function exportJSON() {
  hideExportMenu();
  if (!state.result) return;
  const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sow_result.json';
  a.click();
}


// ═══════════════════════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    state.projects = await res.json();
    renderProjects();
  } catch (_) {}
}

function renderProjects() {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  let projects = state.projects;
  if (state.projectFilter !== 'all') {
    projects = projects.filter(p => p.status === state.projectFilter);
  }

  if (!projects.length) {
    grid.innerHTML = '<div class="empty-state"><h3>אין פרויקטים</h3><p>התחל שיחה עם העוזר כדי ליצור פרויקט חדש</p></div>';
    return;
  }

  const statusLabels = { pending: 'ממתין', wip: 'בעבודה', completed: 'הושלם' };
  const statusColors = { pending: 'var(--amber)', wip: 'var(--indigo)', completed: 'var(--green)' };

  grid.innerHTML = projects.map(p => {
    const date = p.updated_at ? new Date(p.updated_at).toLocaleDateString('he-IL') : '';
    return `
    <div class="gc project-card">
      <div class="project-card-header">
        <div class="project-card-name">${esc(p.name)}</div>
        <span class="project-status-badge" style="color:${statusColors[p.status] || 'var(--t3)'}">${statusLabels[p.status] || p.status}</span>
      </div>
      <div class="project-card-meta">${date} · ${(p.file_paths || []).length} קבצים</div>
      <div class="project-card-actions">
        ${p.result ? `<button class="btn-glass btn-xs" onclick="loadProjectResult('${p.id}')">צפה בתוצאות</button>` : ''}
        ${!p.result && p.status === 'wip' && state.projectId === p.id ? `<button class="btn-grad btn-xs" onclick="viewProjectProcess()">צפה בעיבוד</button>` : ''}
        ${!p.result && p.status === 'wip' && state.projectId !== p.id ? `<button class="btn-glass btn-xs" onclick="restartProject('${p.id}')">הפעל מחדש</button>` : ''}
        <button class="btn-glass btn-xs" onclick="openRenameModal('${p.id}', '${esc(p.name)}')">שנה שם</button>
        <button class="btn-glass btn-xs" style="color:var(--red)" onclick="deleteProject('${p.id}')">מחק</button>
      </div>
    </div>`;
  }).join('');
}

function setProjectFilter(status) {
  state.projectFilter = status;
  document.querySelectorAll('[data-pstatus]').forEach(c =>
    c.classList.toggle('chip-active', c.dataset.pstatus === status));
  renderProjects();
}

async function loadProjectResult(pid) {
  const project = state.projects.find(p => p.id === pid);
  if (project && project.result) {
    state.result = project.result;
    state.sessionId = pid;
    state.projectId = pid;
    renderResultView(project.result);
    showScreen('results');
  }
}

function viewProjectProcess() {
  showScreen('thinking');
}

async function restartProject(pid) {
  const project = state.projects.find(p => p.id === pid);
  if (!project || !project.file_paths || !project.file_paths.length) return;
  state.selectedPaths = [...project.file_paths];
  state.proposedPrompt = project.context || project.name || '';
  state.projectId = pid;
  showScreen('chat');
  startGeneration();
}

function openRenameModal(pid, currentName) {
  state.renameProjectId = pid;
  document.getElementById('rename-input').value = currentName;
  document.getElementById('rename-modal').classList.remove('hidden');
}

function closeRenameModal() {
  document.getElementById('rename-modal').classList.add('hidden');
  state.renameProjectId = null;
}

async function confirmRename() {
  const newName = document.getElementById('rename-input').value.trim();
  if (!newName || !state.renameProjectId) return;
  try {
    await fetch(`/api/projects/${state.renameProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    closeRenameModal();
    loadProjects();
  } catch (_) {}
}

async function deleteProject(pid) {
  if (!confirm('האם למחוק את הפרויקט?')) return;
  try {
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' });
    loadProjects();
  } catch (_) {}
}

async function saveSessionAsProject() {
  if (!state.sessionId) return;
  try {
    await fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: state.sessionId,
        name: state.proposedPrompt ? state.proposedPrompt.substring(0, 50) : 'פרויקט ללא שם',
        chat_history: state.chatHistory,
        file_paths: state.selectedPaths,
      }),
    });
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    const data = await res.json();
    renderAnalytics(data);
  } catch (_) {}
}

function renderAnalytics(data) {
  const grid = document.getElementById('analytics-grid');
  if (!grid) return;

  const p = data.projects || {};
  const f = data.feedback || {};
  const c = data.costs || {};

  grid.innerHTML = `
    <div class="stat-card analytics-stat">
      <div class="stat-number">${p.total || 0}</div>
      <div class="stat-label">סה"כ פרויקטים</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number" style="background:var(--grad-teal);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${p.completed || 0}</div>
      <div class="stat-label">הושלמו</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number">${p.wip || 0}</div>
      <div class="stat-label">בעבודה</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number" style="background:var(--grad-warm);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${f.adoption_rate || 0}%</div>
      <div class="stat-label">שיעור אימוץ</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number">${f.accepts || 0}</div>
      <div class="stat-label">המלצות שאושרו</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number" style="background:linear-gradient(135deg,#dc2626,#ea580c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${f.rejects || 0}</div>
      <div class="stat-label">המלצות שנדחו</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number">${c.api_calls || 0}</div>
      <div class="stat-label">קריאות API</div>
    </div>
    <div class="stat-card analytics-stat">
      <div class="stat-number">$${c.estimated_cost_usd || 0}</div>
      <div class="stat-label">עלות משוערת</div>
    </div>`;

  // Adoption chart with enhanced styling
  const chartEl = document.getElementById('adoption-chart');
  if (chartEl && f.accepts !== undefined) {
    const accepts = f.accepts || 0;
    const rejects = f.rejects || 0;
    const edits = f.edits || 0;
    const total = accepts + rejects + edits || 1;

    // Update adoption stats
    const acceptsPct = total > 0 ? Math.round((accepts / total) * 100) : 0;
    const rejectsPct = total > 0 ? Math.round((rejects / total) * 100) : 0;
    const editsPct = total > 0 ? Math.round((edits / total) * 100) : 0;

    document.getElementById('adoption-accepts').textContent = accepts;
    document.getElementById('adoption-accepts-pct').textContent = acceptsPct + '%';
    document.getElementById('adoption-accepts-bar').style.width = acceptsPct + '%';

    document.getElementById('adoption-rejects').textContent = rejects;
    document.getElementById('adoption-rejects-pct').textContent = rejectsPct + '%';
    document.getElementById('adoption-rejects-bar').style.width = rejectsPct + '%';

    document.getElementById('adoption-edits').textContent = edits;
    document.getElementById('adoption-edits-pct').textContent = editsPct + '%';
    document.getElementById('adoption-edits-bar').style.width = editsPct + '%';

    new Chart(chartEl.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['אושרו', 'נדחו', 'עריכות'],
        datasets: [{
          data: [accepts, rejects, edits],
          backgroundColor: [
            'rgba(8, 145, 178, 0.85)',
            'rgba(124, 58, 237, 0.85)',
            'rgba(79, 70, 229, 0.85)'
          ],
          borderColor: [
            'rgba(255, 255, 255, 0.5)',
            'rgba(255, 255, 255, 0.5)',
            'rgba(255, 255, 255, 0.5)'
          ],
          borderWidth: 2.5,
          hoverBorderWidth: 3.5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 12, weight: '600' },
              color: '#374151',
              padding: 14,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#111827',
            bodyColor: '#374151',
            borderColor: 'rgba(79, 70, 229, 0.2)',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            titleFont: { size: 12, weight: '600' },
            bodyFont: { size: 11 },
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const value = context.parsed.y;
                const percent = total > 0 ? Math.round((value / total) * 100) : 0;
                return context.label + ': ' + value + ' (' + percent + '%)';
              }
            }
          }
        },
      },
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function renderStats() {
  const readable  = SOW_DOCUMENTS.filter(d => d.readable).length;
  const withFixed = SOW_DOCUMENTS.filter(d => d.fixedLink).length;
  const scored    = SOW_DOCUMENTS.filter(d => d.score !== null);
  const avg       = scored.length ? (scored.reduce((s, d) => s + d.score, 0) / scored.length).toFixed(1) : 0;
  const stats = [
    { number: SOW_DOCUMENTS.length, label: 'סה"כ מסמכים' },
    { number: readable, label: 'קריאים' },
    { number: withFixed, label: 'גרסאות משופרות' },
    { number: typeof VENDOR_DATA !== 'undefined' ? VENDOR_DATA.length : 0, label: 'ספקים נחקרו' },
    { number: avg, label: 'ציון ממוצע (מ-5)' },
  ];
  document.getElementById('stats-grid').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-number">${s.number}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

function renderScoreChart() {
  const el = document.getElementById('score-chart');
  if (!el) return;
  const counts = [5,4,3,2,1].map(s => SOW_DOCUMENTS.filter(d => d.score === s).length);
  const unread = SOW_DOCUMENTS.filter(d => d.score === null).length;
  new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['מצוין (5)','טוב (4)','ממוצע (3)','חלש (2)','גרוע (1)','לא קריא'],
      datasets: [{
        label: 'מסמכים',
        data: [...counts, unread],
        backgroundColor: [
          'rgba(8, 145, 178, 0.8)',
          'rgba(79, 70, 229, 0.8)',
          'rgba(217, 119, 6, 0.8)',
          'rgba(124, 58, 237, 0.8)',
          'rgba(219, 39, 119, 0.8)',
          'rgba(107, 114, 128, 0.6)'
        ],
        borderColor: 'rgba(255, 255, 255, 0.3)',
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#111827',
          bodyColor: '#374151',
          borderColor: 'rgba(79, 70, 229, 0.2)',
          borderWidth: 1,
          padding: 10,
          titleFont: { size: 12, weight: '600' },
          bodyFont: { size: 11 },
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,.05)' }
        },
        y: {
          ticks: { font: { size: 12, weight: '500' } },
          grid: { display: false }
        },
      },
    },
  });
}

function renderScoreLegend() {
  const items = [
    { label: 'מצוין', color: 'linear-gradient(135deg, #0891b2 0%, #0d9488 100%)' },
    { label: 'טוב', color: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' },
    { label: 'ממוצע', color: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)' },
    { label: 'חלש', color: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)' },
    { label: 'גרוע', color: 'linear-gradient(135deg, #db2777 0%, #dc2626 100%)' },
    { label: 'לא קריא', color: '#9ca3af' },
  ];
  document.getElementById('score-legend').innerHTML = items.map(i => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${i.color};box-shadow:0 0 8px rgba(0,0,0,.1)"></div><span>${i.label}</span>
    </div>`).join('');
}

function renderScoreFilterChips() {
  const el = document.getElementById('score-filter-chips');
  if (!el) return;
  const chips = [
    { value: 'all', label: 'הכל' }, { value: '5', label: '5' }, { value: '4', label: '4' },
    { value: '3', label: '3' }, { value: '2', label: '2' }, { value: '1', label: '1' },
    { value: 'null', label: '—' },
  ];
  el.innerHTML = chips.map(c =>
    `<button class="chip${c.value === 'all' ? ' chip-active' : ''}"
       data-score="${c.value}" onclick="setScoreFilter('${c.value}')">${c.label}</button>`
  ).join('');
}

function setScoreFilter(val) {
  state.scoreFilter = val;
  document.querySelectorAll('#score-filter-chips .chip').forEach(c =>
    c.classList.toggle('chip-active', c.dataset.score === val));
  renderDocuments();
}

function renderCategoryFilter() {
  const sel = document.getElementById('category-select');
  if (!sel || typeof CATEGORIES === 'undefined') return;
  CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat; sel.appendChild(opt);
  });
}

function getFilteredDocs() {
  return SOW_DOCUMENTS.filter(doc => {
    const sm = state.scoreFilter === 'all' ||
      (state.scoreFilter === 'null' ? doc.score === null : doc.score === parseInt(state.scoreFilter));
    const cm = state.categoryFilter === 'all' || doc.category === state.categoryFilter;
    const q  = state.search.toLowerCase();
    const tm = !q || doc.fileName.toLowerCase().includes(q) ||
               doc.category.toLowerCase().includes(q) || (doc.rationale || '').toLowerCase().includes(q);
    return sm && cm && tm;
  });
}

function renderDocuments() {
  const docs  = getFilteredDocs();
  const grid  = document.getElementById('doc-grid');
  const count = document.getElementById('doc-count');
  if (count) count.textContent = `מציג ${docs.length} מתוך ${SOW_DOCUMENTS.length} מסמכים`;
  if (!grid) return;
  if (!docs.length) {
    grid.innerHTML = `<div class="empty-state"><h3>לא נמצאו מסמכים</h3><p>שנה את הסינון</p></div>`;
    return;
  }
  grid.innerHTML = docs.map(doc => {
    const scoreClass = doc.score !== null ? `score-${doc.score}` : 'score-null';
    return `
      <div class="doc-card" onclick="showModal(${doc.id})" tabindex="0">
        <div class="doc-card-header">
          <div class="doc-card-name">${esc(doc.fileName)}</div>
          <div class="score-badge ${scoreClass}">${doc.score !== null ? doc.score : '—'}</div>
        </div>
        <div class="doc-card-meta">
          <span class="doc-tag">${esc(doc.category)}</span>
          ${doc.date && doc.date !== 'לא ידוע' ? `<span class="doc-tag">${esc(doc.date)}</span>` : ''}
        </div>
        <div style="font-size:.8rem;color:var(--t3);flex:1">${esc(doc.rationale || '')}</div>
      </div>`;
  }).join('');
}

function renderVendors() {
  const container = document.getElementById('vendor-list');
  if (!container || typeof VENDOR_DATA === 'undefined') return;
  const grouped = {};
  VENDOR_DATA.forEach(v => { (grouped[v.category] = grouped[v.category] || []).push(v); });
  container.innerHTML = Object.entries(grouped).map(([cat, vendors]) => `
    <div class="vendor-category-group">
      <div class="vendor-category-title">${esc(cat)} (${vendors.length})</div>
      <div class="vendor-grid">${vendors.map(v => {
        const dots = [1,2,3,4,5].map(i => `<div class="vendor-dot${i <= v.feasibility ? ' on' : ''}"></div>`).join('');
        return `
          <div class="vendor-card">
            <div class="vendor-name">${esc(v.vendor)}</div>
            <div class="vendor-meta">${esc(v.country)} · ${esc(v.category)}</div>
            <div class="vendor-rating">${dots}</div>
          </div>`;
      }).join('')}</div>
    </div>`).join('');
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function showModal(docId) {
  const doc = SOW_DOCUMENTS.find(d => d.id === docId);
  if (!doc) return;
  document.getElementById('modal-title').textContent = doc.fileName;
  const tabs = [
    { id: 'analysis', label: 'ניתוח' },
    { id: 'research', label: 'מחקר' },
    { id: 'vendors', label: 'ספקים' },
    { id: 'recs', label: 'המלצות' },
  ];
  if (doc.fixedLink) tabs.push({ id: 'fixed', label: 'גרסה משופרת' });
  document.getElementById('modal-tabs').innerHTML = tabs.map((t, i) =>
    `<button class="tab-btn${i === 0 ? ' tab-active' : ''}" data-tab="${t.id}"
       onclick="setModalTab('${t.id}')">${t.label}</button>`
  ).join('');
  document.getElementById('modal-body').innerHTML = tabs.map((t, i) => {
    let content = '';
    if (t.id === 'analysis') content = doc.detailedAnalysis ? doc.detailedAnalysis.split(' | ').map(d => {
      const ci = d.indexOf(':');
      if (ci === -1) return `<div style="margin-bottom:.5rem;font-size:.85rem;color:var(--t2)">${esc(d)}</div>`;
      return `<div style="margin-bottom:.75rem"><div style="font-weight:700;font-size:.85rem;color:var(--t1)">${esc(d.substring(0,ci).trim())}</div><div style="font-size:.83rem;color:var(--t2)">${esc(d.substring(ci+1).trim())}</div></div>`;
    }).join('') : '<div class="empty-state">אין ניתוח</div>';
    else if (t.id === 'research') content = `<div class="markdown-body">${marked.parse(doc.externalResearch || 'אין נתונים')}</div>`;
    else if (t.id === 'vendors') content = `<div style="font-size:.85rem;color:var(--t2);line-height:1.6">${esc(doc.vendorFeasibility || 'אין נתונים')}</div>`;
    else if (t.id === 'recs') content = doc.recommendations ? `<div class="markdown-body">${marked.parse(doc.recommendations)}</div>` : '<div class="empty-state">אין המלצות</div>';
    else if (t.id === 'fixed') content = `<div style="display:flex;gap:.5rem;margin-bottom:1rem"><button class="btn-grad btn-sm" onclick="loadFixedDoc(${doc.id})">טען מסמך</button><a href="/data/SOW/${esc(doc.fixedLink)}" target="_blank" class="btn-glass btn-sm">הורד MD</a></div><div id="fixed-content">לחץ "טען מסמך" לצפייה</div>`;
    return `<div class="tab-content${i === 0 ? ' tab-active' : ''}" id="mtab-${t.id}">${content}</div>`;
  }).join('');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function setModalTab(tabId) {
  document.querySelectorAll('#modal-tabs .tab-btn').forEach(b =>
    b.classList.toggle('tab-active', b.dataset.tab === tabId));
  document.querySelectorAll('#modal-body .tab-content').forEach(el =>
    el.classList.toggle('tab-active', el.id === `mtab-${tabId}`));
}

async function loadFixedDoc(docId) {
  const doc = SOW_DOCUMENTS.find(d => d.id === docId);
  if (!doc || !doc.fixedLink) return;
  const el = document.getElementById('fixed-content');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--t3)">טוען...</span>';
  try {
    const res = await fetch(`/data/SOW/${doc.fixedLink}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    el.innerHTML = `<div class="markdown-body">${marked.parse(await res.text())}</div>`;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red)">שגיאה: ${esc(e.message)}</div>`;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
