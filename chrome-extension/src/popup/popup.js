/**
 * Popup script for Honoka extension — MCP-only architecture.
 * Shows extension's own feature status (tracking, current page).
 * Sync happens via AI assistants (Antigravity/Codex/Claude Desktop) — no live MCP status.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const trackingStatus = document.getElementById('trackingStatus');
  const trackedCount = document.getElementById('trackedCount');
  const pageStatus = document.getElementById('pageStatus');
  const optionsLink = document.getElementById('optionsLink');

  // ── Tracking status ──
  const data = await chrome.storage.local.get(['honoka_global_index', 'honoka_tracking_disabled']);
  const index = data.honoka_global_index || [];
  trackedCount.textContent = String(index.length);
  trackingStatus.textContent = data.honoka_tracking_disabled ? '已停用' : '啟用中';
  trackingStatus.className = 'status-value ' + (data.honoka_tracking_disabled ? 'off' : 'on');

  // ── Current page detection (Notion session for token budget) ──
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /notion\.(so|site)/.test(tab.url)) {
      pageStatus.textContent = 'Notion 頁面 — Token budget 可用';
      pageStatus.className = 'status-value on';
    } else {
      pageStatus.textContent = '非 Notion 頁面';
      pageStatus.className = 'status-value';
    }
  } catch {
    pageStatus.textContent = '無法偵測';
  }

  // ── Options page ──
  optionsLink.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
