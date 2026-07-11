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

// ── Page history storage (serialized queue) ─────────────────────────
// All mutations to honoka_global_index and honoka_page_* keys go through
// this queue to prevent race conditions when multiple Notion tabs write
// concurrently.

function _pageKey(pageId) { return `honoka_page_${pageId}`; }

let _storageQueue = Promise.resolve();

function enqueue(fn) {
  _storageQueue = _storageQueue
    .then(fn)
    .catch((e) => console.warn('Honoka storage queue error:', e));
  return _storageQueue;
}

function handleUpsertPageEntry({ pageId, title, url, tokenSnapshot, properties, extras }) {
  return enqueue(() => new Promise((resolve) => {
    const pk = _pageKey(pageId);
    chrome.storage.local.get([pk, 'honoka_global_index', 'honoka_history_limit'], (data) => {
      const existing = data[pk] || {};
      const limit = data.honoka_history_limit || 200;
      const index = data.honoka_global_index || [];
      const now = new Date().toISOString();

      const newUsable = title && title !== 'Untitled';
      const oldUsable = existing.title && existing.title !== 'Untitled';
      let bestTitle;
      if (newUsable && oldUsable) {
        bestTitle = title.length >= existing.title.length ? title : existing.title;
      } else if (newUsable) {
        bestTitle = title;
      } else if (oldUsable) {
        bestTitle = existing.title;
      } else {
        bestTitle = title || existing.title || 'Untitled';
      }

      const entry = {
        title: bestTitle,
        url,
        first_seen: existing.first_seen || now,
        last_seen: now,
        visit_count: existing.visit_count ? existing.visit_count + 1 : 1,
        token_snapshot: tokenSnapshot,
      };
      if (extras) Object.assign(entry, extras);
      if (existing.favorite) entry.favorite = true;
      if (properties && Object.keys(properties).length > 0) {
        entry.properties = properties;
      } else if (existing.properties) {
        entry.properties = existing.properties;
      }
      if (existing.meta) entry.meta = existing.meta;
      if (existing.api_properties) entry.api_properties = existing.api_properties;

      const newIndex = index.includes(pageId) ? index : [...index, pageId];
      const toStore = { [pk]: entry, honoka_global_index: newIndex };

      if (limit > 0 && newIndex.length > limit) {
        const allKeys = newIndex.map((id) => _pageKey(id));
        chrome.storage.local.get(allKeys, (allData) => {
          const sorted = newIndex.slice().sort((a, b) => {
            const ea = allData[_pageKey(a)] || {};
            const eb = allData[_pageKey(b)] || {};
            return (eb.last_seen || '').localeCompare(ea.last_seen || '');
          });
          const keep = sorted.slice(0, limit);
          const drop = sorted.slice(limit);
          toStore.honoka_global_index = keep;
          chrome.storage.local.remove(drop.map((id) => _pageKey(id)), () => {
            chrome.storage.local.set(toStore, () => resolve({ ok: true }));
          });
        });
      } else {
        chrome.storage.local.set(toStore, () => resolve({ ok: true }));
      }
    });
  }));
}

function handlePatchPageMeta({ pageId, meta, apiProperties }) {
  return enqueue(() => new Promise((resolve) => {
    const pk = _pageKey(pageId);
    chrome.storage.local.get([pk], (data) => {
      const entry = data[pk];
      if (!entry) { resolve({ ok: false }); return; }
      if (meta) entry.meta = meta;
      if (apiProperties && Object.keys(apiProperties).length > 0) {
        entry.api_properties = apiProperties;
      }
      chrome.storage.local.set({ [pk]: entry }, () => resolve({ ok: true }));
    });
  }));
}

function handlePatchPageTitle({ pageId, title, properties }) {
  return enqueue(() => new Promise((resolve) => {
    const pk = _pageKey(pageId);
    chrome.storage.local.get([pk], (data) => {
      const entry = data[pk];
      if (!entry) { resolve({ ok: false }); return; }
      if (!entry.title || entry.title === 'Untitled') {
        entry.title = title;
      }
      if (properties && Object.keys(properties).length > 0) {
        entry.properties = properties;
      }
      chrome.storage.local.set({ [pk]: entry }, () => resolve({ ok: true }));
    });
  }));
}

function handleDeletePages({ pageIds }) {
  return enqueue(() => new Promise((resolve) => {
    const keysToRemove = pageIds.map(_pageKey);
    chrome.storage.local.get(['honoka_global_index'], (data) => {
      const index = (data.honoka_global_index || []).filter((id) => !pageIds.includes(id));
      chrome.storage.local.remove(keysToRemove, () => {
        chrome.storage.local.set({ honoka_global_index: index }, () => {
          resolve({ ok: true, deleted: pageIds.length });
        });
      });
    });
  }));
}

function handleClearAllHistory() {
  return enqueue(() => new Promise((resolve) => {
    chrome.storage.local.get(['honoka_global_index'], (data) => {
      const index = data.honoka_global_index || [];
      const keysToRemove = index.map(_pageKey);
      chrome.storage.local.remove(keysToRemove, () => {
        chrome.storage.local.set({ honoka_global_index: [] }, () => {
          resolve({ ok: true, deleted: index.length });
        });
      });
    });
  }));
}

function handleEnforceLimit({ limit }) {
  return enqueue(() => new Promise((resolve) => {
    chrome.storage.local.get(['honoka_global_index'], (data) => {
      const index = data.honoka_global_index || [];
      if (!limit || limit <= 0 || index.length <= limit) {
        resolve({ ok: true, dropped: 0 });
        return;
      }
      const pageKeys = index.map(_pageKey);
      chrome.storage.local.get(pageKeys, (allData) => {
        const sorted = index.slice().sort((a, b) => {
          const ea = allData[_pageKey(a)] || {};
          const eb = allData[_pageKey(b)] || {};
          return (eb.last_seen || '').localeCompare(ea.last_seen || '');
        });
        const keep = sorted.slice(0, limit);
        const drop = sorted.slice(limit);
        chrome.storage.local.remove(drop.map(_pageKey), () => {
          chrome.storage.local.set({ honoka_global_index: keep }, () => {
            resolve({ ok: true, dropped: drop.length });
          });
        });
      });
    });
  }));
}


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

    // ── Page history tracking ──
    case 'upsertPageEntry':
      handleUpsertPageEntry(request).then(r => sendResponse(r));
      return true;

    case 'patchPageMeta':
      handlePatchPageMeta(request).then(r => sendResponse(r));
      return true;

    case 'patchPageTitle':
      handlePatchPageTitle(request).then(r => sendResponse(r));
      return true;

    case 'deletePages':
      handleDeletePages(request).then(r => sendResponse(r));
      return true;

    case 'clearAllHistory':
      handleClearAllHistory().then(r => sendResponse(r));
      return true;

    case 'enforceLimit':
      handleEnforceLimit(request).then(r => sendResponse(r));
      return true;

    case 'getTitleFromHistory':
      chrome.history.search({ text: '', maxResults: 500, startTime: 0 }, (results) => {
        if (chrome.runtime.lastError || !results) {
          sendResponse({ title: null });
          return;
        }
        let match = results.find((r) => r.url === request.url);
        if (!match && request.pageId) {
          match = results.find((r) => r.url && r.url.includes(request.pageId));
        }
        const title = match?.title || null;
        if (title) {
          const cleaned = title.replace(/\s*[|–—]\s*Notion\s*$/, '').trim();
          sendResponse({ title: cleaned || title });
        } else {
          sendResponse({ title: null });
        }
      });
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
