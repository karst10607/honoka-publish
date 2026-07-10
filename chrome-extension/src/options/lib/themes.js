/**
 * Theme system for Doc Library.
 * Persists choice in chrome.storage.sync.
 */

const THEMES = {
  dark: {
    '--bg': '#0d1117',
    '--sidebar-bg': '#161b22',
    '--surface': '#1c2333',
    '--text': '#e6edf3',
    '--text-muted': '#8b949e',
    '--border': '#30363d',
    '--primary': '#58a6ff',
    '--accent': '#3fb950',
    '--danger': '#f85149',
    '--row-hover': '#1c2333',
    '--row-alt': '#111820',
    '--scrollbar': '#30363d',
    '--shadow': 'rgba(0,0,0,0.3)',
  },
  light: {
    '--bg': '#ffffff',
    '--sidebar-bg': '#f6f8fa',
    '--surface': '#ffffff',
    '--text': '#24292f',
    '--text-muted': '#656d76',
    '--border': '#d0d7de',
    '--primary': '#0969da',
    '--accent': '#1a7f37',
    '--danger': '#cf222e',
    '--row-hover': '#f6f8fa',
    '--row-alt': '#f6f8fa',
    '--scrollbar': '#d0d7de',
    '--shadow': 'rgba(0,0,0,0.08)',
  },
  midnight: {
    '--bg': '#0a0e27',
    '--sidebar-bg': '#0f1535',
    '--surface': '#141b4d',
    '--text': '#c8d6e5',
    '--text-muted': '#5f6caf',
    '--border': '#1e2a6a',
    '--primary': '#7c8cf0',
    '--accent': '#54e3aa',
    '--danger': '#ff6b6b',
    '--row-hover': '#141b4d',
    '--row-alt': '#0f1535',
    '--scrollbar': '#1e2a6a',
    '--shadow': 'rgba(0,0,0,0.4)',
  },
  sakura: {
    '--bg': '#1a1418',
    '--sidebar-bg': '#211a20',
    '--surface': '#2d2230',
    '--text': '#e8d5e0',
    '--text-muted': '#a08090',
    '--border': '#4a3345',
    '--primary': '#ff8fab',
    '--accent': '#c084fc',
    '--danger': '#e04060',
    '--row-hover': '#2d2230',
    '--row-alt': '#211a20',
    '--scrollbar': '#4a3345',
    '--shadow': 'rgba(0,0,0,0.3)',
  },
};

const STORAGE_KEY = 'honoka_theme';

export function getThemes() {
  return Object.keys(THEMES);
}

export function getTheme(name) {
  return THEMES[name] || THEMES.dark;
}

export function setTheme(name) {
  const vars = THEMES[name];
  if (!vars) return;
  const root = document.documentElement;
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val);
  }
  try {
    chrome.storage.sync.set({ [STORAGE_KEY]: name });
  } catch {}
}

export async function initTheme() {
  let name = 'dark';
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) name = result[STORAGE_KEY];
  } catch {}
  setTheme(name);
  return name;
}
