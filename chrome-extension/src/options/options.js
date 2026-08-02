/**
 * Honoka Doc Library — Entry Point
 * Wires together sidebar, doc table, themes, and settings.
 */
import { initTheme } from './lib/themes.js';
import { initSidebar, updateSidebarCounts, setLoading } from './lib/sidebar.js';
import { fetchDocs, setFilter, initDocTable } from './lib/doclib.js';

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

  // 4. Init MCP setup modal
  initSetupModal();

  // 5. Load docs
  await loadDocs();
});

async function loadDocs() {
  setLoading(true);

  // MCP-only architecture: docs come from local tracking history (chrome.storage)
  allDocs = await fetchDocs();
  const statusBar = document.getElementById('status-bar');
  const trackedCount = allDocs.filter(d => d._tracked).length;

  if (allDocs.length > 0) {
    statusBar.textContent = trackedCount > 0
      ? `${allDocs.length} docs — ${trackedCount} 頁面來自 Notion 追蹤`
      : `${allDocs.length} docs`;
    statusBar.className = 'status-bar ok';
  } else {
    document.getElementById('doc-tbody').innerHTML =
      `<tr><td colspan="5" class="empty-state">
        尚未有追蹤記錄。開啟 Notion 頁面即會自動記錄，
        或透過 AI 助理（Antigravity / Codex / Claude Desktop）用 honoka 工具管理文件庫。
      </td></tr>`;
    statusBar.textContent = '本機追蹤模式 — 無文件';
    statusBar.className = 'status-bar warn';
    setLoading(false);
    return;
  }

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

// ══ MCP Setup Modal ══

function initSetupModal() {
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('modal-close');
  const copyBtn = document.getElementById('copy-prompt');
  const promptArea = document.getElementById('setup-prompt');
  const saveStatus = document.getElementById('saveStatus');

  // Close modal
  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  // Copy the AI prompt to clipboard
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(promptArea.value);
      saveStatus.textContent = '✅ 已複製，貼給你的 AI 助理！';
    } catch {
      promptArea.select();
      document.execCommand('copy');
      saveStatus.textContent = '✅ 已複製，貼給你的 AI 助理！';
    }
    setTimeout(() => { saveStatus.textContent = ''; }, 4000);
  });
}
