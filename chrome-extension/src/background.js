/**
 * Background service worker — MCP-only architecture.
 * Pure frontend: page history tracking, settings, token budget analysis.
 * No Bridge/daemon dependency — all sync goes through MCP server.
 */

// ── State ──
const state = {
  settings: {
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

function handleUpsertPageEntry({ pageId, title, url, source, tokenSnapshot, properties, extras }) {
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

      const resolvedSource = source || existing.source || detectSourceFromUrl(url);

      const entry = {
        title: bestTitle,
        url,
        source: resolvedSource,
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
});

// ── Message Handler ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getStatus':
      sendResponse({
        notionConfigured: !!(state.settings.notionPat && state.settings.notionDatabaseId),
        autoPush: state.settings.autoPush,
      });
      return false;

    case 'saveSettings':
      saveSettings(request.settings).then(() => {
        sendResponse({ ok: true });
      }).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'getSettings':
      sendResponse({ settings: state.settings });
      return false;

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
}

// ── Utilities ──
function detectSourceFromUrl(url) {
  if (!url) return 'web';
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h.includes('github.com')) return 'github';
    if (h.includes('jira') || h.endsWith('atlassian.net')) return 'jira';
    if (h.includes('confluence')) return 'confluence';
    if (h.includes('drive.google.com')) return 'google_drive';
    if (h.includes('notion.')) return 'notion';
    return 'web';
  } catch {
    return 'web';
  }
}
