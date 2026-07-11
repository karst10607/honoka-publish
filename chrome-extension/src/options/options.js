/**
 * Honoka Doc Library — Entry Point
 * Wires together sidebar, doc table, themes, and settings.
 */
import { initTheme } from './lib/themes.js';
import { initSidebar, updateSidebarCounts, setLoading } from './lib/sidebar.js';
import { fetchDocs, setFilter, initDocTable, checkBridge } from './lib/doclib.js';

let allDocs = [];
let viewFilter = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Apply persisted theme
  const currentTheme = await initTheme();
  document.getElementById('theme-switcher')?.querySelector(`[data-theme="${currentTheme}"]`)?.classList.add('active');

  // 2. Init sidebar
  initSidebar(handleViewChange);

  // 3. Init doc table (search, sort, export)
  initDocTable();

  // 4. Init settings modal
  initSettings();

  // 5. Load docs
  await loadDocs();
});

async function loadDocs() {
  setLoading(true);

  const bridgeOk = await checkBridge();
  const statusBar = document.getElementById('status-bar');

  if (!bridgeOk) {
    document.getElementById('doc-tbody').innerHTML =
      `<tr><td colspan="5" class="empty-state">
        Bridge offline. <a href="#" id="retry-link">Retry</a> or
        start with: <code>npx honoka-publish bridge</code>
      </td></tr>`;
    statusBar.textContent = 'Bridge offline — start honoka-publish bridge to view docs';
    statusBar.className = 'status-bar err';
    setLoading(false);

    document.getElementById('retry-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await loadDocs();
    });
    return;
  }

  statusBar.textContent = 'Bridge connected — loading docs...';
  statusBar.className = 'status-bar ok';

  allDocs = await fetchDocs();

  statusBar.textContent = allDocs.length > 0
    ? `Bridge online — ${allDocs.length} docs loaded`
    : 'Bridge online — no docs found. Clip something!';
  statusBar.className = 'status-bar ok';

  // Update sidebar counts
  updateSidebarCounts(allDocs);

  // Apply current view filter
  if (viewFilter) {
    setFilter(viewFilter);
  } else {
    setFilter(() => true);
  }

  setLoading(false);
}

function handleViewChange(filterFn) {
  viewFilter = filterFn;
  setFilter(filterFn);
}

// ══ Settings Modal ══

function initSettings() {
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('modal-close');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // Load settings
  chrome.runtime.sendMessage({ action: 'getSettings' }).then(resp => {
    if (!resp) return;
    document.getElementById('bridgeUrl').value = resp.settings.bridgeUrl || '';
    document.getElementById('notionPat').value = resp.settings.notionPat || '';
    document.getElementById('notionDatabaseId').value = resp.settings.notionDatabaseId || '';
    document.getElementById('autoPush').checked = resp.settings.autoPush || false;
  });

  // Close modal
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const settings = {
      bridgeUrl: document.getElementById('bridgeUrl').value.trim() || 'http://127.0.0.1:44124',
      notionPat: document.getElementById('notionPat').value.trim(),
      notionDatabaseId: document.getElementById('notionDatabaseId').value.trim(),
      autoPush: document.getElementById('autoPush').checked,
    };

    try {
      const result = await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
      if (result.ok) {
        saveStatus.textContent = 'Saved!';
        saveStatus.style.color = 'var(--accent)';
        modal.classList.add('hidden');
      } else {
        saveStatus.textContent = 'Error: ' + (result.error || 'unknown');
        saveStatus.style.color = 'var(--danger)';
      }
    } catch (err) {
      saveStatus.textContent = 'Error: ' + err.message;
      saveStatus.style.color = 'var(--danger)';
    }

    setTimeout(() => { saveStatus.textContent = ''; }, 3000);
  });
}
