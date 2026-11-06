/**
 * LEAD TRACK — GAIN30 Style Dark Emerald Controller
 */

import {
  db,
  toDateKey,
  getLastNDaysKeys,
  exportRecordsToCSV
} from './db.js';
import {
  processScreenshotsOCR,
  extractPhoneNumbersFromText
} from './ocr.js';

const SVG_ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`
};

const state = {
  currentView: 'dashboard', // 'dashboard' | 'user' | 'agent'
  selectedDateKey: toDateKey(new Date()),
  todayKey: toDateKey(new Date()),
  last30Days: getLastNDaysKeys(30, new Date()),

  userTab: 'all',
  userSearch: '',
  userSelectedIds: new Set(),

  agentTab: 'all',
  agentSearch: '',
  agentSelectedIds: new Set(),

  ocrModalModule: 'user',
  ocrLatestFiles: [],

  snapshot: null,
  thirtyDayReports: []
};

async function initApp() {
  try {
    await db.init();
    if (!localStorage.getItem('leadtrack_clean_v10')) {
      await db.clearAllData();
      localStorage.setItem('leadtrack_clean_v10', 'true');
    }
    bindEventListeners();
    await refreshAllData();
  } catch (err) {
    console.error('Init error:', err);
    showToast('Error: ' + err.message, 'negative');
  }
}

async function refreshAllData() {
  state.todayKey = toDateKey(new Date());
  state.last30Days = getLastNDaysKeys(30, new Date());
  const activeDate = state.selectedDateKey || state.todayKey;

  const [snapshot, thirtyDayReports] = await Promise.all([
    db.getHistoricalSnapshotForDate(activeDate),
    db.getThirtyDayReports(new Date())
  ]);

  state.snapshot = snapshot;
  state.thirtyDayReports = thirtyDayReports;

  updateDateStepperBar();
  setText('sidebar-user-count', snapshot.userNumbers.length);
  setText('sidebar-agent-count', snapshot.agentNumbers.length);

  renderDashboard();
  renderSection('user');
  renderSection('agent');
}

function updateDateStepperBar() {
  const days = state.last30Days;
  const idx = days.indexOf(state.selectedDateKey);
  const dayNum = idx === -1 ? 30 : idx + 1;

  setText('day-counter-pill', `DAY ${dayNum} / 30`);

  const dObj = new Date(`${state.selectedDateKey}T12:00:00`);
  const formatted = dObj.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  setText('stepper-date-text', formatted);

  const select = document.getElementById('global-date-select');
  if (select) {
    select.innerHTML = [...days]
      .reverse()
      .map((d) => `<option value="${d}" ${d === state.selectedDateKey ? 'selected' : ''}>${d}</option>`)
      .join('');
  }
}

/* ==========================================================================
   1. DASHBOARD (GAIN30 HERO, RING GAUGES & CHECKLIST CARDS)
   ========================================================================== */
function renderDashboard() {
  if (!state.snapshot) return;
  const { userStats, agentStats } = state.snapshot;
  const reports = state.thirtyDayReports || [];

  const user30dImports = reports.reduce((acc, r) => acc + (r.user.importedOnDay || 0), 0);
  const agent30dImports = reports.reduce((acc, r) => acc + (r.agent.importedOnDay || 0), 0);

  const combinedTotal = userStats.total + agentStats.total;
  const combinedPos = userStats.positive + agentStats.positive;
  const combinedNeg = userStats.negative + agentStats.negative;
  const combinedPen = userStats.pending + agentStats.pending;
  const combinedToday = userStats.importedOnDay + agentStats.importedOnDay;
  const posPct = combinedTotal ? Math.round((combinedPos / combinedTotal) * 100) : 0;

  // Hero Card
  setText('dash-combined-total', combinedTotal);
  setText('dash-today-gain-pill', `+${combinedToday} today`);
  setText('dash-user-total', userStats.total);
  setText('Sub-user-total', userStats.total);
  setText('dash-agent-total', agentStats.total);
  setText('dash-positive-rate', `${posPct}% Positive`);
  setText('dash-combined-positive', combinedPos);
  setText('dash-combined-negative', combinedNeg);
  setText('dash-combined-pending', combinedPen);

  const heroBar = document.getElementById('dash-progress-fill');
  if (heroBar) heroBar.style.width = `${posPct}%`;

  // Circular Ring Gauges (circumference = 2 * PI * 46 = 289)
  const circum = 289;
  const uRatio = userStats.total ? userStats.positive / userStats.total : 0;
  const aRatio = agentStats.total ? agentStats.positive / agentStats.total : 0;

  const uCircle = document.getElementById('user-ring-circle');
  if (uCircle) uCircle.style.strokeDashoffset = String(Math.round(circum * (1 - uRatio)));

  const aCircle = document.getElementById('agent-ring-circle');
  if (aCircle) aCircle.style.strokeDashoffset = String(Math.round(circum * (1 - aRatio)));

  setText('dash-user-positive', userStats.positive);
  setText('ring-user-total', userStats.total);
  setText('dash-user-pending', userStats.pending);
  setText('dash-user-negative', userStats.negative);

  setText('dash-agent-positive', agentStats.positive);
  setText('ring-agent-total', agentStats.total);
  setText('dash-agent-pending', agentStats.pending);
  setText('dash-agent-negative', agentStats.negative);

  // Two Checklist Cards
  setText('user-ratio-pill', `${userStats.positive} / ${userStats.total}`);
  setText('agent-ratio-pill', `${agentStats.positive} / ${agentStats.total}`);
  setText('dash-user-today-imports', userStats.importedOnDay);
  setText('dash-user-30d-imports', user30dImports);
  setText('dash-agent-today-imports', agentStats.importedOnDay);
  setText('dash-agent-30d-imports', agentStats.importedOnDay);

  const uMiniBar = document.getElementById('user-mini-bar');
  if (uMiniBar) uMiniBar.style.width = `${Math.round(uRatio * 100)}%`;

  const aMiniBar = document.getElementById('agent-mini-bar');
  if (aMiniBar) aMiniBar.style.width = `${Math.round(aRatio * 100)}%`;
}

/* ==========================================================================
   2 & 3. USER AND AGENT LIST SECTIONS
   ========================================================================== */
function getFilteredNumbers(module) {
  if (!state.snapshot) return { allMatching: [], tabFiltered: [] };
  const isUser = module === 'user';
  const rawList = isUser ? state.snapshot.userNumbers : state.snapshot.agentNumbers;
  const search = (isUser ? state.userSearch : state.agentSearch).trim().toLowerCase();
  const activeTab = isUser ? state.userTab : state.agentTab;

  const allMatching = rawList.filter((item) => {
    if (!search) return true;
    return `${item.phone} ${item.rawPhone} ${item.phoneKey}`.toLowerCase().includes(search);
  });

  allMatching.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const tabFiltered =
    activeTab === 'all'
      ? allMatching
      : allMatching.filter((item) => item.status === activeTab);

  return { allMatching, tabFiltered };
}

function renderSection(module) {
  if (!state.snapshot) return;
  const isUser = module === 'user';
  const { allMatching, tabFiltered } = getFilteredNumbers(module);

  const penList = allMatching.filter((n) => n.status === 'pending');
  const posList = allMatching.filter((n) => n.status === 'positive');
  const negList = allMatching.filter((n) => n.status === 'negative');

  setText(`${module}-count-all`, allMatching.length);
  setText(`${module}-count-pending`, penList.length);
  setText(`${module}-count-positive`, posList.length);
  setText(`${module}-count-negative`, negList.length);

  const selectedSet = isUser ? state.userSelectedIds : state.agentSelectedIds;
  const validIds = new Set(allMatching.map((n) => n.id));
  for (const id of selectedSet) {
    if (!validIds.has(id)) selectedSet.delete(id);
  }
  setText(`${module}-selected-count`, selectedSet.size);

  const selectAllCb = document.getElementById(`${module}-select-all`);
  if (selectAllCb) {
    selectAllCb.checked =
      tabFiltered.length > 0 && tabFiltered.every((n) => selectedSet.has(n.id));
  }

  const container = document.getElementById(`${module}-list-container`);
  if (!container) return;

  const activeTab = isUser ? state.userTab : state.agentTab;
  if (activeTab === 'all') {
    container.innerHTML = renderGroupedSectionsHTML(module, penList, posList, negList);
  } else {
    container.innerHTML = renderNumberCardsList(
      tabFiltered,
      module,
      `No ${activeTab} numbers in ${module.toUpperCase()} list.`
    );
  }
}

function renderGroupedSectionsHTML(module, penList, posList, negList) {
  const total = penList.length + posList.length + negList.length;
  if (total === 0) {
    return `
      <div class="empty-state">
        No numbers in ${module.toUpperCase()} list yet. Tap "+ Scan OCR" or "+ Manual" above.
      </div>
    `;
  }

  const renderBlock = (title, list) =>
    list.length === 0
      ? ''
      : `
      <div style="margin-bottom: 10px;">
        <div class="section-group-header">${title} (${list.length})</div>
        <div class="number-list-container">
          ${list.map((item) => renderSingleNumberCard(item, module)).join('')}
        </div>
      </div>
    `;

  return (
    renderBlock('Pending Queue', penList) +
    renderBlock('Positive', posList) +
    renderBlock('Negative', negList)
  );
}

function renderNumberCardsList(records, module, emptyMessage) {
  if (!records || records.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }
  return records.map((item) => renderSingleNumberCard(item, module)).join('');
}

function renderSingleNumberCard(item, module) {
  const selectedSet = module === 'user' ? state.userSelectedIds : state.agentSelectedIds;
  const isSelected = selectedSet.has(item.id);

  return `
    <div class="number-card status-${item.status}" data-number-id="${item.id}">
      <div class="number-card-left">
        <input
          type="checkbox"
          class="number-select-cb"
          data-select-id="${item.id}"
          data-select-mod="${module}"
          ${isSelected ? 'checked' : ''}
        />
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="phone-number-text">${escapeHtml(item.phone)}</span>
            <span class="status-badge ${item.status}">${escapeHtml(item.status)}</span>
          </div>
          <div class="number-meta-row">${item.importDateKey}</div>
        </div>
      </div>

      <div class="number-card-actions">
        <div class="status-tri-group">
          <button
            type="button"
            class="status-action-btn btn-pos ${item.status === 'positive' ? 'active' : ''}"
            data-status-btn="positive"
            data-id="${item.id}"
            data-mod="${module}"
          >
            Positive
          </button>
          <button
            type="button"
            class="status-action-btn btn-neg ${item.status === 'negative' ? 'active' : ''}"
            data-status-btn="negative"
            data-id="${item.id}"
            data-mod="${module}"
          >
            Negative
          </button>
          <button
            type="button"
            class="status-action-btn btn-pen ${item.status === 'pending' ? 'active' : ''}"
            data-status-btn="pending"
            data-id="${item.id}"
            data-mod="${module}"
          >
            Pending
          </button>
        </div>

        <div class="card-utility-btns">
          <button type="button" class="icon-action-btn" data-edit-id="${item.id}" data-edit-mod="${module}" title="Edit">${SVG_ICONS.edit}</button>
          <button type="button" class="icon-action-btn" data-delete-id="${item.id}" data-delete-mod="${module}" title="Delete">${SVG_ICONS.trash}</button>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   NAVIGATION & EVENTS
   ========================================================================== */
function switchView(viewName) {
  state.currentView = viewName;

  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === viewName);
  });
}

function bindEventListeners() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.nav));
  });

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const html = document.documentElement;
    html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // Top Header & Hero Quick Buttons
  document.getElementById('header-btn-scan')?.addEventListener('click', () => {
    openOCRModal(state.currentView === 'agent' ? 'agent' : 'user');
  });

  document.getElementById('hero-btn-log-number')?.addEventListener('click', () => {
    openManualModal('user');
  });

  document.getElementById('quick-btn-user-ocr')?.addEventListener('click', () => openOCRModal('user'));
  document.getElementById('quick-btn-agent-ocr')?.addEventListener('click', () => openOCRModal('agent'));

  // Date Stepper Controls (< | Date | Jump to Today | >)
  document.getElementById('btn-prev-day')?.addEventListener('click', async () => {
    const idx = state.last30Days.indexOf(state.selectedDateKey);
    if (idx > 0) {
      state.selectedDateKey = state.last30Days[idx - 1];
      await refreshAllData();
    }
  });

  document.getElementById('btn-next-day')?.addEventListener('click', async () => {
    const idx = state.last30Days.indexOf(state.selectedDateKey);
    if (idx !== -1 && idx < state.last30Days.length - 1) {
      state.selectedDateKey = state.last30Days[idx + 1];
      await refreshAllData();
    }
  });

  document.getElementById('global-date-select')?.addEventListener('change', async (e) => {
    state.selectedDateKey = e.target.value;
    await refreshAllData();
  });

  document.getElementById('btn-return-today')?.addEventListener('click', async () => {
    state.selectedDateKey = state.todayKey;
    await refreshAllData();
  });

  document.querySelectorAll('[data-goto-module]').forEach((el) => {
    el.addEventListener('click', () => switchView(el.dataset.gotoModule));
  });

  document.querySelectorAll('[data-goto-user-filter]').forEach((box) => {
    box.addEventListener('click', () => {
      state.userTab = box.dataset.gotoUserFilter;
      syncTabs('user');
      switchView('user');
      renderSection('user');
    });
  });

  ['user', 'agent'].forEach((mod) => {
    document.getElementById(`btn-${mod}-import-ocr`)?.addEventListener('click', () => openOCRModal(mod));
    document.getElementById(`btn-${mod}-add-manual`)?.addEventListener('click', () => openManualModal(mod));
    document.getElementById(`btn-${mod}-export-csv`)?.addEventListener('click', () => exportSectionCSV(mod));

    document.querySelectorAll(`[data-${mod}-tab]`).forEach((tab) => {
      tab.addEventListener('click', () => {
        if (mod === 'user') state.userTab = tab.dataset.userTab;
        else state.agentTab = tab.dataset.agentTab;
        syncTabs(mod);
        renderSection(mod);
      });
    });

    document.getElementById(`${mod}-search-input`)?.addEventListener('input', (e) => {
      if (mod === 'user') state.userSearch = e.target.value;
      else state.agentSearch = e.target.value;
      renderSection(mod);
    });

    document.getElementById(`${mod}-select-all`)?.addEventListener('change', (e) => {
      const { tabFiltered } = getFilteredNumbers(mod);
      const set = mod === 'user' ? state.userSelectedIds : state.agentSelectedIds;
      if (e.target.checked) tabFiltered.forEach((n) => set.add(n.id));
      else tabFiltered.forEach((n) => set.delete(n.id));
      renderSection(mod);
    });

    document.querySelectorAll(`[data-${mod}-bulk]`).forEach((btn) => {
      btn.addEventListener('click', () => handleBulkAction(mod, btn.dataset[`${mod}Bulk`]));
    });
  });

  document.getElementById('main-content')?.addEventListener('click', async (e) => {
    const statusBtn = e.target.closest('[data-status-btn]');
    if (statusBtn) {
      const id = statusBtn.dataset.id;
      const mod = statusBtn.dataset.mod;
      const newStatus = statusBtn.dataset.statusBtn;
      await db.updateNumbersStatus({ module: mod, numberIds: [id], newStatus });
      await refreshAllData();
      showToast(`Moved to ${newStatus.toUpperCase()}`, newStatus);
      return;
    }

    const editBtn = e.target.closest('[data-edit-id]');
    if (editBtn) {
      openEditNumberModal(editBtn.dataset.editMod, editBtn.dataset.editId);
      return;
    }

    const delBtn = e.target.closest('[data-delete-id]');
    if (delBtn) {
      await db.deleteNumbers({
        module: delBtn.dataset.deleteMod,
        numberIds: [delBtn.dataset.deleteId]
      });
      await refreshAllData();
      showToast('Deleted', 'negative');
    }
  });

  document.getElementById('main-content')?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-select-id]');
    if (!cb) return;
    const mod = cb.dataset.selectMod;
    const set = mod === 'user' ? state.userSelectedIds : state.agentSelectedIds;
    if (cb.checked) set.add(cb.dataset.selectId);
    else set.delete(cb.dataset.selectId);
    renderSection(mod);
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.closeModal)?.classList.add('hidden');
    });
  });

  bindOCRModalEvents();
  bindManualModalEvents();
  bindEditModalEvents();
}

function syncTabs(mod) {
  const active = mod === 'user' ? state.userTab : state.agentTab;
  document.querySelectorAll(`[data-${mod}-tab]`).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset[`${mod}Tab`] === active);
  });
}

async function handleBulkAction(module, action) {
  const selectedSet = module === 'user' ? state.userSelectedIds : state.agentSelectedIds;
  const ids = Array.from(selectedSet);
  if (ids.length === 0) {
    showToast('Select numbers first', 'pending');
    return;
  }

  if (action === 'positive' || action === 'negative' || action === 'pending') {
    await db.updateNumbersStatus({ module, numberIds: ids, newStatus: action });
    selectedSet.clear();
    await refreshAllData();
    showToast(`Moved ${ids.length} number(s) to ${action.toUpperCase()}`, action);
  } else if (action === 'delete') {
    await db.deleteNumbers({ module, numberIds: ids });
    selectedSet.clear();
    await refreshAllData();
    showToast(`Deleted ${ids.length} number(s)`, 'negative');
  }
}

/* ==========================================================================
   MODALS: OCR, MANUAL, EDIT
   ========================================================================== */
function openOCRModal(module) {
  state.ocrModalModule = module;
  state.ocrLatestFiles = [];

  setText('ocr-modal-badge', `${module.toUpperCase()} MODULE`);
  document.getElementById('ocr-progress-box').classList.add('hidden');
  document.getElementById('ocr-results-panel').classList.add('hidden');
  document.getElementById('ocr-extracted-textarea').value = '';
  document.getElementById('btn-confirm-ocr-import').disabled = true;
  document.getElementById('ocr-file-input').value = '';
  document.getElementById('modal-ocr-import').classList.remove('hidden');
}

function bindOCRModalEvents() {
  const fileInput = document.getElementById('ocr-file-input');
  const textarea = document.getElementById('ocr-extracted-textarea');
  const confirmBtn = document.getElementById('btn-confirm-ocr-import');

  document.getElementById('btn-trigger-file-input')?.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    const progressBox = document.getElementById('ocr-progress-box');
    const stageEl = document.getElementById('ocr-progress-stage');
    const pctEl = document.getElementById('ocr-progress-pct');
    const fillEl = document.getElementById('ocr-progress-fill');
    const resultsPanel = document.getElementById('ocr-results-panel');

    progressBox.classList.remove('hidden');
    resultsPanel.classList.add('hidden');

    const ocrOutcome = await processScreenshotsOCR(files, (prog) => {
      stageEl.textContent = prog.stage;
      pctEl.textContent = `${prog.percent}%`;
      fillEl.style.width = `${prog.percent}%`;
    });

    state.ocrLatestFiles = files.map((f) => f.name);
    textarea.value = ocrOutcome.extractedNumbers.map((n) => n.phone).join('\n');
    setText('ocr-extracted-count', ocrOutcome.extractedNumbers.length);
    resultsPanel.classList.remove('hidden');
    confirmBtn.disabled = ocrOutcome.extractedNumbers.length === 0;
  });

  textarea?.addEventListener('input', () => {
    const parsed = extractPhoneNumbersFromText(textarea.value);
    setText('ocr-extracted-count', parsed.length);
    confirmBtn.disabled = parsed.length === 0;
  });

  confirmBtn?.addEventListener('click', async () => {
    const extracted = extractPhoneNumbersFromText(textarea.value);
    if (extracted.length === 0) return;

    const result = await db.importNumbers({
      module: state.ocrModalModule,
      rawNumbers: extracted.map((item) => ({
        phone: item.phone,
        sourceFile: state.ocrLatestFiles[0] || 'Screenshot'
      })),
      sourceType: 'ocr',
      sourceFiles: state.ocrLatestFiles
    });

    document.getElementById('modal-ocr-import').classList.add('hidden');
    switchView(state.ocrModalModule);
    await refreshAllData();
    showToast(`Imported ${result.addedRecords.length} number(s)`, 'positive');
  });
}

function openManualModal(module) {
  document.getElementById('manual-module-input').value = module;
  setText('manual-modal-badge', `${module.toUpperCase()} MODULE`);
  document.getElementById('manual-numbers-textarea').value = '';
  document.getElementById('modal-manual-entry').classList.remove('hidden');
}

function bindManualModalEvents() {
  document.getElementById('form-manual-entry')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const module = document.getElementById('manual-module-input').value;
    const rawInput = document.getElementById('manual-numbers-textarea').value;
    const lines = rawInput
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    const res = await db.importNumbers({
      module,
      rawNumbers: lines,
      sourceType: 'manual'
    });

    document.getElementById('modal-manual-entry').classList.add('hidden');
    await refreshAllData();
    showToast(`Added ${res.addedRecords.length} number(s)`, 'positive');
  });
}

async function openEditNumberModal(module, numberId) {
  const storeName = module === 'user' ? 'user_numbers' : 'agent_numbers';
  const list = await db.getAll(storeName);
  const record = list.find((r) => r.id === numberId);
  if (!record) return;

  document.getElementById('edit-number-id').value = record.id;
  document.getElementById('edit-number-module').value = module;
  document.getElementById('edit-phone-input').value = record.phone;
  document.getElementById('edit-status-select').value = record.status;
  document.getElementById('modal-edit-number').classList.remove('hidden');
}

function bindEditModalEvents() {
  document.getElementById('form-edit-number')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-number-id').value;
    const module = document.getElementById('edit-number-module').value;
    const phone = document.getElementById('edit-phone-input').value;
    const status = document.getElementById('edit-status-select').value;

    try {
      await db.editNumber({ module, id, phone, status });
      document.getElementById('modal-edit-number').classList.add('hidden');
      await refreshAllData();
      showToast('Updated', status);
    } catch (err) {
      showToast(err.message, 'negative');
    }
  });
}

function exportSectionCSV(module) {
  const { tabFiltered } = getFilteredNumbers(module);
  const headers = [
    { key: 'phone', label: 'Mobile Number' },
    { key: 'status', label: 'Status' },
    { key: 'importDateKey', label: 'Date' }
  ];
  exportRecordsToCSV(`${module}_numbers_${state.selectedDateKey}.csv`, headers, tabFiltered);
  showToast(`Exported ${tabFiltered.length} number(s)`, 'positive');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, type = 'positive') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', initApp);
