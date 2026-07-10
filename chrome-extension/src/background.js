/**
 * Background service worker — clean-room implementation.
 * Manages Bridge detection, clip orchestration, and Notion push.
 */

import { BridgeClient, DEFAULT_BRIDGE_URL } from './lib/bridge.js';
import { NotionClient, markdownToBlocks } from './lib/notion.js';

// ── State ──
const state = {
  bridge: null,
  bridgeAvailable: false,
  bridgeVersion: '',
  settings: {
    bridgeUrl: DEFAULT_BRIDGE_URL,
    notionPat: '',
    notionDatabaseId: '',
    autoPush: false,
  },
};

// ── Init ──
chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();
  createContextMenus();
  checkBridge();
});

// ── Context Menus ──
function createContextMenus() {
  chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'clip-page',
    title: 'Clip to Honoka',
    contexts: ['page', 'selection'],
  });
  chrome.contextMenus.create({
    id: 'clip-to-notion',
    title: 'Clip to Honoka + Push to Notion',
    contexts: ['page', 'selection'],
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'clip-page') {
    await clipTab(tab.id, { pushToNotion: false });
  } else if (info.menuItemId === 'clip-to-notion') {
    await clipTab(tab.id, { pushToNotion: true });
  }
});

// ── Message Handler ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getStatus':
      sendResponse({
        bridgeAvailable: state.bridgeAvailable,
        bridgeVersion: state.bridgeVersion,
        notionConfigured: !!(state.settings.notionPat && state.settings.notionDatabaseId),
        autoPush: state.settings.autoPush,
      });
      return false;

    case 'clipPage':
      clipTab(request.tabId || sender.tab?.id, {
        pushToNotion: request.pushToNotion || state.settings.autoPush,
      }).then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'clipUrl':
      clipUrl(request.url, {
        pushToNotion: request.pushToNotion || state.settings.autoPush,
      }).then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'saveSettings':
      saveSettings(request.settings).then(() => {
        sendResponse({ ok: true });
      }).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'getSettings':
      sendResponse({ settings: state.settings, bridgeAvailable: state.bridgeAvailable });
      return false;

    case 'checkBridge':
      checkBridge().then(status => sendResponse(status));
      return true;

    default:
      sendResponse({ ok: false, error: `Unknown action: ${request.action}` });
      return false;
  }
});

// ── Bridge Detection ──
let bridgeCheckInterval = null;

async function checkBridge() {
  const client = getBridgeClient();
  const health = await client.health();
  state.bridgeAvailable = health.ok;
  if (health.ok) {
    state.bridgeVersion = health.version;
  }
  return { bridgeAvailable: state.bridgeAvailable, bridgeVersion: state.bridgeVersion };
}

function getBridgeClient() {
  if (!state.bridge) {
    state.bridge = new BridgeClient(state.settings.bridgeUrl);
  }
  return state.bridge;
}

// Periodically check Bridge (every 30s when popup might be open)
function startBridgePolling() {
  if (bridgeCheckInterval) clearInterval(bridgeCheckInterval);
  bridgeCheckInterval = setInterval(checkBridge, 30000);
}

// ── Clipping ──

/** Clip a tab (inject content script, extract content). */
async function clipTab(tabId, opts = {}) {
  // Ensure content script is loaded
  let injected = false;
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch {
    // Content script not loaded — inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/clipper.js'],
      });
      injected = true;
    } catch (err) {
      // activeTab only grants access to the active tab.
      // If injection fails (e.g. clipUrl opens a background tab),
      // activate the tab and retry once.
      if (opts._retried) throw new Error('Cannot access this page. Try navigating to it first.');
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(r => setTimeout(r, 500));
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/clipper.js'],
      });
      injected = true;
    }
  }

  // Wait a beat for content script to initialize after injection
  if (injected) await new Promise(r => setTimeout(r, 100));

  // Ask content script to clip
  const result = await chrome.tabs.sendMessage(tabId, { action: 'clipPage' });
  if (!result.ok) throw new Error(result.error || 'Clip failed');

  // Save via Bridge or standalone
  if (state.bridgeAvailable) {
    const client = getBridgeClient();
    await client.saveClip({
      title: result.title,
      markdown: result.markdown,
      url: result.url,
      source: 'extension',
    });
  } else {
    // Standalone: download as .md file
    const filename = sanitizeFilename(result.title) + '.md';
    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename });
    URL.revokeObjectURL(url);
  }

  // Optional: push to Notion
  if (opts.pushToNotion && state.settings.notionPat) {
    await pushToNotion(result.title, result.markdown);
  }

  return { ok: true, title: result.title, slug: sanitizeFilename(result.title) };
}

/** Clip a URL by opening it in a hidden tab and extracting content. */
async function clipUrl(url, opts = {}) {
  // Open in new tab (inactive), clip it, then close
  const tab = await chrome.tabs.create({ url, active: false });
  // Wait for page to load
  await waitForTabLoaded(tab.id);
  const result = await clipTab(tab.id, { ...opts, _retried: true });
  await chrome.tabs.remove(tab.id);
  return result;
}

function waitForTabLoaded(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Small delay to let dynamic content render
        setTimeout(resolve, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout fallback
    setTimeout(resolve, 15000);
  });
}

// ── Notion Push (Standalone) ──
async function pushToNotion(title, markdown) {
  const { notionPat, notionDatabaseId } = state.settings;
  if (!notionPat || !notionDatabaseId) {
    throw new Error('Notion not configured: set PAT and Database ID in options');
  }

  const client = new NotionClient(notionPat);

  // Create page in database
  const page = await client.createPage(notionDatabaseId, title);

  // Convert markdown to blocks and append
  const blocks = markdownToBlocks(markdown);
  if (blocks.length > 0) {
    // Notion limits blocks per request to ~100
    const chunkSize = 100;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await client.appendBlocks(page.id, chunk);
    }
  }

  return { ok: true, pageId: page.id, pageUrl: page.url };
}

// ── Settings ──
async function loadSettings() {
  const data = await chrome.storage.local.get('honokaSettings');
  if (data.honokaSettings) {
    state.settings = { ...state.settings, ...data.honokaSettings };
  }
}

async function saveSettings(newSettings) {
  state.settings = { ...state.settings, ...newSettings };
  await chrome.storage.local.set({ honokaSettings: state.settings });
  // Reset bridge client if URL changed
  if (newSettings.bridgeUrl) {
    state.bridge = new BridgeClient(newSettings.bridgeUrl);
  }
}

// ── Utilities ──
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// ── Live Cycle ―
startBridgePolling();
