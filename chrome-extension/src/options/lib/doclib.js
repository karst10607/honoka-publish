/**
 * Doc Library — doc listing, table rendering, search, sort, export.
 * Communicates with Bridge HTTP API for data and merges local tracking history.
 */

const BRIDGE_URL = 'http://127.0.0.1:44124';
let allDocs = [];
let filteredDocs = [];
let currentFilter = null; // filter function
let currentSort = { field: 'lastModified', asc: false };
let searchQuery = '';

const COLUMNS = [
  { id: 'title', label: 'Title', sortable: true },
  { id: 'category', label: 'Category', sortable: true },
  { id: 'lastModified', label: 'Modified', sortable: true },
  { id: 'size', label: 'Size', sortable: true },
  { id: 'source', label: 'Source', sortable: false },
];

/**
 * Fetch docs from Bridge /api/docs and merge with local tracking history.
 */
export async function fetchDocs() {
  let bridgeDocs = [];
  try {
    const resp = await fetch(`${BRIDGE_URL}/api/docs`);
    if (!resp.ok) throw new Error(`Bridge returned ${resp.status}`);
    const data = await resp.json();
    bridgeDocs = (data.docs || []).map(normalizeDoc);
  } catch (err) {
    console.warn('DocLib: Bridge fetch failed', err.message);
  }

  // Load local tracking history from chrome.storage
  const trackedDocs = await loadLocalHistory();

  // Merge: Bridge docs first, then tracked entries (skip duplicates by URL)
  const merged = [...bridgeDocs];
  for (const t of trackedDocs) {
    const isDuplicate = bridgeDocs.some(d => d.url && t.url && d.url === t.url);
    if (!isDuplicate) {
      merged.push(t);
    }
  }

  allDocs = merged;
  return allDocs;
}

/**
 * Load local Notion page tracking history from chrome.storage.
 */
async function loadLocalHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['honoka_global_index'], (data) => {
      const index = data.honoka_global_index || [];
      if (index.length === 0) {
        resolve([]);
        return;
      }
      const pageKeys = index.map((id) => `honoka_page_${id}`);
      chrome.storage.local.get(pageKeys, (pageData) => {
        const entries = [];
        for (const pageId of index) {
          const entry = pageData[`honoka_page_${pageId}`];
          if (!entry) continue;
          entries.push({
            _tracked: true,
            _pageId: pageId,
            title: entry.title || 'Untitled',
            path: `_tracked/${pageId}`,
            category: extractCategory(entry),
            lastModified: entry.last_seen || entry.first_seen || new Date().toISOString(),
            size: entry.token_snapshot || 0,
            source: entry.source || (entry.url ? formatSource(entry.url) : ''),
            url: entry.url,
            visit_count: entry.visit_count || 1,
          });
        }
        resolve(entries);
      });
    });
  });
}

function extractCategory(entry) {
  if (entry.properties) {
    const p = entry.properties;
    if (p.category || p.Category) return p.category || p.Category;
    if (p.status || p.Status) return p.status || p.Status;
    if (p.type || p.Type) return p.type || p.Type;
    if (p.tag || p.tags) return p.tag || (Array.isArray(p.tags) ? p.tags[0] : p.tags);
  }
  if (entry.api_properties) {
    const ap = entry.api_properties;
    for (const key of Object.keys(ap)) {
      const lower = key.toLowerCase();
      if (lower === 'category' || lower === 'type' || lower === 'status') {
        const v = ap[key].value || ap[key];
        if (v && typeof v === 'string') return v;
      }
    }
  }
  return 'Notion';
}

// ── Source icon map ─────────────────────────────────────────────────

const SOURCE_ICONS = {
  notion: '📝',
  github: '🐙',
  jira: '🔧',
  confluence: '📋',
  google_drive: '📁',
  telegram: '✈️',
  discord: '💬',
  anytype: '🔵',
  web: '🌐',
};

const SOURCE_LABELS = {
  notion: 'Notion',
  github: 'GitHub',
  jira: 'Jira',
  confluence: 'Confluence',
  google_drive: 'Google Drive',
  telegram: 'Telegram',
  discord: 'Discord',
  anytype: 'AnyType',
  web: 'Web',
};

function normalizeDoc(d) {
  return {
    title: d.title || d.path?.split('/').pop() || 'untitled',
    path: d.path || '',
    category: d.category || 'uncategorized',
    lastModified: d.lastModified || new Date().toISOString(),
    size: d.size || 0,
    source: d.source || '',
    hasIndex: true,
  };
}

/**
 * Set the current filter function (called by sidebar).
 */
export function setFilter(filterFn) {
  currentFilter = filterFn;
  applyFilters();
}

function applyFilters() {
  let docs = allDocs;

  // View filter
  if (currentFilter) {
    docs = docs.filter(currentFilter);
  }

  // Search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    docs = docs.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      (d.source && d.source.toLowerCase().includes(q))
    );
  }

  filteredDocs = docs;
  sortAndRender();
}

/**
 * Set search query and re-filter.
 */
export function setSearch(query) {
  searchQuery = query.trim();
  applyFilters();
}

/**
 * Sort by field and re-render.
 */
export function setSort(field) {
  if (currentSort.field === field) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.field = field;
    currentSort.asc = field === 'title'; // title asc by default
  }
  sortAndRender();
}

function sortAndRender() {
  const { field, asc } = currentSort;
  const sorted = [...filteredDocs].sort((a, b) => {
    let va = a[field];
    let vb = b[field];
    if (field === 'lastModified') {
      va = new Date(va).getTime();
      vb = new Date(vb).getTime();
    } else if (field === 'size') {
      va = Number(va);
      vb = Number(vb);
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });

  renderTable(sorted);
  updateCounts(sorted.length);
}

function renderTable(docs) {
  const tbody = document.getElementById('doc-tbody');
  if (!tbody) return;

  if (docs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${
      searchQuery ? 'No docs match your search.' : 'No docs found. Visit Notion pages to auto-track them, or clip something with the Bridge!' 
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(d => {
    const relTime = formatRelativeTime(d.lastModified);
    const sizeStr = d._tracked
      ? (d.visit_count > 0 ? `${d.visit_count} visits` : '')
      : formatSize(d.size);
    const catClass = 'cat-' + (d.category || 'uncategorized').replace(/\s+/g, '-').toLowerCase();
    const trackedAttr = d._tracked ? ' data-tracked="true"' : '';
    const urlAttr = d.url ? ` data-url="${escapeHtml(d.url)}"` : '';
    const sourceName = d._tracked ? getSourceLabel(d.source) : formatSource(d.source);
    const sourceIcon = d._tracked ? getSourceIcon(d.source) : '📄';
    return `
      <tr class="doc-row" data-path="${d.path}"${trackedAttr}${urlAttr}>
        <td class="col-title">
          <span class="doc-icon">${d._tracked ? sourceIcon : '📄'}</span>
          <span class="doc-name">${escapeHtml(d.title)}</span>
        </td>
        <td><span class="cat-badge ${catClass}">${escapeHtml(d.category || '')}</span></td>
        <td class="col-date" title="${d.lastModified}">${relTime}</td>
        <td class="col-size">${sizeStr}</td>
        <td class="col-source">${d._tracked
          ? `<span class="source-badge src-${escapeHtml(d.source || 'web')}">${sourceIcon} ${escapeHtml(sourceName)}</span>`
          : formatSource(d.source)}</td>
      </tr>
    `;
  }).join('');

  // Bind row clicks — tracked docs open Notion URL, Bridge docs open preview
  tbody.querySelectorAll('.doc-row').forEach(row => {
    row.addEventListener('click', () => {
      const path = row.dataset.path;
      if (row.dataset.tracked === 'true' && row.dataset.url) {
        window.open(row.dataset.url, '_blank');
      } else if (path) {
        openPreview(path);
      }
    });
  });
}

function updateCounts(count) {
  const el = document.getElementById('doc-count');
  if (el) el.textContent = `${count} of ${allDocs.length} docs`;
}

/**
 * Export docs as JSON.
 */
export function exportDocs(format) {
  const docs = filteredDocs.length > 0 ? filteredDocs : allDocs;

  if (format === 'json') {
    const blob = new Blob([JSON.stringify({ docs, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `honoka-docs-${Date.now()}.json`);
  } else if (format === 'csv') {
    const header = 'title,path,category,lastModified,size,source\n';
    const rows = docs.map(d => {
      const esc = s => '"' + String(s || '').replace(/"/g, '""') + '"';
      return [esc(d.title), esc(d.path), esc(d.category), d.lastModified, d.size, esc(d.source)].join(',');
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    downloadBlob(blob, `honoka-docs-${Date.now()}.csv`);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open a doc preview in a new tab via Bridge /files/ endpoint.
 */
function openPreview(path) {
  if (!path) return;
  const url = `${BRIDGE_URL}/files/${path}/index.md`;
  // Try to open the raw markdown
  window.open(url, '_blank');
}

/**
 * Check Bridge health.
 */
export async function checkBridge() {
  try {
    const resp = await fetch(`${BRIDGE_URL}/status`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/** Initialize search and export bindings */
export function initDocTable() {
  // Search
  const searchBox = document.getElementById('search-box');
  if (searchBox) {
    searchBox.addEventListener('input', () => setSearch(searchBox.value));
  }

  // Sort on column header click
  document.getElementById('doc-thead')?.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-field]');
    if (!th) return;
    const field = th.dataset.field;
    setSort(field);
    // Update sort indicators
    document.querySelectorAll('th[data-field]').forEach(el => el.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(currentSort.asc ? 'sort-asc' : 'sort-desc');
  });

  // Export buttons
  document.getElementById('export-json')?.addEventListener('click', () => exportDocs('json'));
  document.getElementById('export-csv')?.addEventListener('click', () => exportDocs('csv'));
}

// ── Utility ──

function formatRelativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatSource(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.length > 40 ? url.substring(0, 40) + '...' : url;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getSourceIcon(source) {
  return SOURCE_ICONS[source] || '📄';
}

function getSourceLabel(source) {
  return SOURCE_LABELS[source] || source || 'Unknown';
}
