/**
 * Sidebar module — smart views, folder tree, theme switcher.
 * Communicates with doclib via a callback.
 */

let onSelectView = null; // callback: (filterFn) => void
let allDocs = [];
let currentView = 'all';
let folderTreeExpanded = {};

const VIEWS = [
  { id: 'all', icon: '📄', label: 'All Docs' },
  { id: 'local', icon: '💾', label: 'Local Only' },
  { id: 'recent', icon: '🕐', label: 'Recent (7d)' },
  { id: 'favorites', icon: '★', label: 'Favorites' },
];

/**
 * Initialize the sidebar.
 * @param {Function} onSelect - callback(filterFn) when view changes
 */
export function initSidebar(onSelect) {
  onSelectView = onSelect;
  renderViews();
  renderThemeSwitcher();
  bindBridgeStatus();
  bindSettingsBtn();
  bindEvents();
}

function renderViews() {
  const list = document.getElementById('sidebar-views');
  if (!list) return;
  list.innerHTML = VIEWS.map(v => `
    <div class="sidebar-item" data-view="${v.id}">
      <span class="si-icon">${v.icon}</span>
      <span class="si-label">${v.label}</span>
      <span class="si-badge" id="badge-${v.id}"></span>
    </div>
  `).join('');

  // Category tree container
  const tree = document.getElementById('folder-tree');
  if (tree) tree.innerHTML = '';
}

export function updateSidebarCounts(docs) {
  allDocs = docs;
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;

  const counts = {
    all: docs.length,
    local: docs.filter(d => d.category !== 'notion').length,
    recent: docs.filter(d => new Date(d.lastModified).getTime() > weekAgo).length,
    favorites: 0,
  };

  // Favorites count from storage
  try {
    chrome.storage.sync.get('honoka_favorites', (r) => {
      const favs = r.honoka_favorites || [];
      const favBadge = document.getElementById('badge-favorites');
      if (favBadge) favBadge.textContent = favs.length || '';
    });
  } catch {}

  for (const [view, count] of Object.entries(counts)) {
    const badge = document.getElementById(`badge-${view}`);
    if (badge) badge.textContent = count > 0 ? count : '';
  }

  // Render categories from docs
  renderCategories(docs);
}

function renderCategories(docs) {
  const tree = document.getElementById('folder-tree');
  if (!tree) return;

  const cats = {};
  for (const d of docs) {
    const c = d.category || 'uncategorized';
    if (!cats[c]) cats[c] = [];
    cats[c].push(d);
  }

  const sorted = Object.entries(cats).sort((a, b) => b[1].length - a[1].length);

  tree.innerHTML = sorted.map(([cat, items]) => {
    const isExpanded = folderTreeExpanded[cat] !== false;
    return `
      <div class="folder-item" data-category="${cat}">
        <div class="folder-header">
          <span class="folder-toggle">${isExpanded ? '▾' : '▸'}</span>
          <span class="folder-icon">📁</span>
          <span class="folder-name">${cat}</span>
          <span class="si-badge">${items.length}</span>
        </div>
        <div class="folder-children" style="display:${isExpanded ? 'block' : 'none'}">
          ${items.slice(0, 10).map(d => {
            const title = d.title || 'untitled';
            return `<div class="folder-file" data-path="${d.path}">📄 ${escapeHtml(title)}</div>`;
          }).join('')}
          ${items.length > 10 ? `<div class="folder-file folder-file-more">+${items.length - 10} more</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderThemeSwitcher() {
  const container = document.getElementById('theme-switcher');
  if (!container) return;
  const names = ['dark', 'light', 'midnight', 'sakura'];
  const emojis = { dark: '🌙', light: '☀️', midnight: '🌌', sakura: '🌸' };

  container.innerHTML = names.map(n => `
    <div class="theme-swatch" data-theme="${n}" title="${n}">
      ${emojis[n] || '●'}
    </div>
  `).join('');
}

function bindBridgeStatus() {
  const dot = document.getElementById('bridge-dot');
  const popover = document.getElementById('bridge-popover');
  if (!dot || !popover) return;

  // Check Bridge health periodically
  async function check() {
    try {
      const resp = await fetch('http://127.0.0.1:44124/status');
      const data = await resp.json();
      dot.className = 'bridge-dot online';
      dot.title = 'Bridge Online v' + (data.version || '');
    } catch {
      dot.className = 'bridge-dot offline';
      dot.title = 'Bridge Offline';
    }
  }
  check();
  setInterval(check, 30000);

  dot.addEventListener('click', (e) => {
    popover.classList.toggle('hidden');
    e.stopPropagation();
  });
  document.addEventListener('click', () => popover.classList.add('hidden'));
}

function bindSettingsBtn() {
  const btn = document.getElementById('settings-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
  });
}

function bindEvents() {
  // View clicks
  document.getElementById('sidebar-views')?.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (!item) return;
    const view = item.dataset.view;
    setActiveView(view);
  });

  // Folder toggle
  document.getElementById('folder-tree')?.addEventListener('click', (e) => {
    const toggle = e.target.closest('.folder-toggle');
    if (toggle) {
      const item = toggle.closest('.folder-item');
      const children = item?.querySelector('.folder-children');
      if (children) {
        const isOpen = children.style.display !== 'none';
        children.style.display = isOpen ? 'none' : 'block';
        toggle.textContent = isOpen ? '▸' : '▾';
        const cat = item?.dataset.category;
        if (cat) folderTreeExpanded[cat] = !isOpen;
      }
      return;
    }

    // Folder header click → filter by category
    const header = e.target.closest('.folder-header');
    if (header) {
      const item = header.closest('.folder-item');
      const cat = item?.dataset.category;
      if (cat) filterByCategory(cat);
      return;
    }

    // File click → preview
    const file = e.target.closest('.folder-file');
    if (file) {
      const path = file.dataset.path;
      if (path && onSelectView) {
        onSelectView(() => allDocs.filter(d => d.path === path));
      }
    }
  });

  // Theme swatches
  document.getElementById('theme-switcher')?.addEventListener('click', async (e) => {
    const swatch = e.target.closest('.theme-swatch');
    if (!swatch) return;
    const { setTheme } = await import('./themes.js');
    setTheme(swatch.dataset.theme);
  });
}

function setActiveView(view) {
  currentView = view;
  // Update active class
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.sidebar-item[data-view="${view}"]`);
  if (active) active.classList.add('active');

  // Update view title
  const title = document.getElementById('view-title');
  const v = VIEWS.find(x => x.id === view);
  if (title && v) title.textContent = v.label;

  // Notify doclib
  if (onSelectView) {
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;

    let filterFn;
    switch (view) {
      case 'all':
        filterFn = () => true;
        break;
      case 'local':
        filterFn = d => d.category !== 'notion';
        break;
      case 'recent':
        filterFn = d => new Date(d.lastModified).getTime() > weekAgo;
        break;
      case 'favorites':
        // Get favorite paths from storage
        chrome.storage.sync.get('honoka_favorites', (r) => {
          const favs = r.honoka_favorites || [];
          if (onSelectView) onSelectView(d => favs.includes(d.path));
        });
        return;
      default:
        filterFn = () => true;
    }
    onSelectView(filterFn);
  }
}

function filterByCategory(cat) {
  currentView = 'cat:' + cat;
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));

  const title = document.getElementById('view-title');
  if (title) title.textContent = cat;

  if (onSelectView) {
    onSelectView(d => (d.category || 'uncategorized') === cat);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Show/hide loading spinner */
export function setLoading(isLoading) {
  const el = document.getElementById('view-title');
  if (el) el.textContent = isLoading ? 'Loading...' : 'All Docs';
}
