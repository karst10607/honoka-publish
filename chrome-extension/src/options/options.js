/**
 * Options page for Honoka Publish extension.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const bridgeUrl = document.getElementById('bridgeUrl');
  const notionPat = document.getElementById('notionPat');
  const notionDatabaseId = document.getElementById('notionDatabaseId');
  const autoPush = document.getElementById('autoPush');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');
  const bridgeInfo = document.getElementById('bridgeInfo');
  const notionInfo = document.getElementById('notionInfo');

  // Load current settings
  const resp = await chrome.runtime.sendMessage({ action: 'getSettings' });
  if (resp) {
    bridgeUrl.value = resp.settings.bridgeUrl || '';
    notionPat.value = resp.settings.notionPat || '';
    notionDatabaseId.value = resp.settings.notionDatabaseId || '';
    autoPush.checked = resp.settings.autoPush || false;
    updateStatus(resp);
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const settings = {
      bridgeUrl: bridgeUrl.value.trim() || 'http://127.0.0.1:44124',
      notionPat: notionPat.value.trim(),
      notionDatabaseId: notionDatabaseId.value.trim(),
      autoPush: autoPush.checked,
    };

    try {
      const result = await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
      if (result.ok) {
        saveStatus.textContent = '✅ Settings saved';
        saveStatus.style.color = 'var(--success)';
        updateStatus({ settings, bridgeAvailable: false }); // will re-check
        // Re-check Bridge
        const check = await chrome.runtime.sendMessage({ action: 'checkBridge' });
        updateStatus({ settings, ...check });
      } else {
        saveStatus.textContent = `❌ ${result.error}`;
        saveStatus.style.color = 'var(--error)';
      }
    } catch (err) {
      saveStatus.textContent = `❌ ${err.message}`;
      saveStatus.style.color = 'var(--error)';
    }

    setTimeout(() => { saveStatus.textContent = ''; }, 3000);
  });

  function updateStatus(data) {
    if (data.bridgeAvailable) {
      bridgeInfo.textContent = '✅ Bridge Online';
      bridgeInfo.className = 'info ok';
    } else {
      bridgeInfo.textContent = '❌ Bridge Offline (optional)';
      bridgeInfo.className = 'info err';
    }

    const hasNotion = !!(data.settings?.notionPat && data.settings?.notionDatabaseId);
    if (hasNotion) {
      notionInfo.textContent = '✅ Notion configured';
      notionInfo.className = 'info ok';
    } else {
      notionInfo.textContent = '⚠️ Notion not configured (standalone clip still works)';
      notionInfo.className = 'info err';
    }
  }
});

// Toggle password visibility (called from inline onclick)
function togglePwd(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}
