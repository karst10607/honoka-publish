/**
 * Popup script for Honoka Publish extension.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const clipBtn = document.getElementById('clipBtn');
  const clipAndPushBtn = document.getElementById('clipAndPushBtn');
  const urlInput = document.getElementById('urlInput');
  const urlClipBtn = document.getElementById('urlClipBtn');
  const resultDiv = document.getElementById('result');
  const bridgeStatus = document.getElementById('bridgeStatus');
  const statusText = document.getElementById('statusText');
  const optionsLink = document.getElementById('optionsLink');

  // Load status
  const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
  updateStatus(status);

  // Clip current page
  clipBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showResult('No active tab found', 'error');
    await doClip(tab.id, false);
  });

  // Clip and push to Notion
  clipAndPushBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showResult('No active tab found', 'error');
    await doClip(tab.id, true);
  });

  // Clip URL
  urlClipBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return showResult('Enter a URL', 'error');
    if (!url.startsWith('http')) return showResult('Invalid URL (must start with http)', 'error');
    const result = await chrome.runtime.sendMessage({ action: 'clipUrl', url, pushToNotion: false });
    handleClipResult(result);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') urlClipBtn.click();
  });

  // Options page
  optionsLink.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  async function doClip(tabId, pushToNotion) {
    const result = await chrome.runtime.sendMessage({
      action: 'clipPage',
      tabId,
      pushToNotion,
    });
    handleClipResult(result);
  }

  function handleClipResult(result) {
    if (result.ok) {
      let msg = `✅ Clipped: ${result.title}`;
      if (result.slug) msg += `\n   Saved as: ${result.slug}.md`;
      showResult(msg, 'success');
    } else {
      showResult(`❌ ${result.error}`, 'error');
    }
  }

  function showResult(msg, type) {
    resultDiv.textContent = msg;
    resultDiv.className = `result ${type}`;
    resultDiv.classList.remove('hidden');
    setTimeout(() => resultDiv.classList.add('hidden'), 5000);
  }

  function updateStatus(status) {
    if (status.bridgeAvailable) {
      bridgeStatus.className = 'status-dot online';
      bridgeStatus.title = `Bridge v${status.bridgeVersion}`;
      statusText.textContent = `Bridge connected (v${status.bridgeVersion})`;
    } else {
      bridgeStatus.className = 'status-dot offline';
      statusText.textContent = 'Bridge offline — files will download';
    }
  }
});
