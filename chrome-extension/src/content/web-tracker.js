/**
 * Honoka Web Tracker — auto-records page visits on code-hosting, project management,
 * and document websites (GitHub, Jira, Confluence, Google Drive, etc.).
 *
 * Injected via content_scripts (see manifest.json).
 * - Detects source from hostname
 * - Extracts title from DOM (document.title, og:title, h1)
 * - Uses URL hash as stable pageId (dedup across sessions)
 * - Sends tracking data to background.js for storage
 */

// ── Source detection ────────────────────────────────────────────────

function detectSource() {
  const host = window.location.hostname;
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  if (host.endsWith('atlassian.net') || host.includes('jira')) return 'jira';
  if (host.includes('confluence')) return 'confluence';
  if (host === 'drive.google.com') return 'google_drive';
  if (host.includes('notion.')) return 'notion';
  return 'web';
}

// ── Page title extraction ───────────────────────────────────────────

function isUsableTitle(t) {
  if (!t || t === 'Untitled') return false;
  return t.trim().length > 0;
}

function getPageTitle() {
  // 1. Open Graph title
  const og = document.querySelector('meta[property="og:title"]');
  if (og && isUsableTitle(og.content)) return og.content.trim();

  // 2. document.title (strip site suffix like " — SiteName" or " | SiteName")
  if (document.title && isUsableTitle(document.title)) {
    const cleaned = document.title.replace(/\s*[—–|/]\s*[^—–|/]+$/, '').trim();
    if (isUsableTitle(cleaned)) return cleaned;
  }

  // 3. First h1
  const h1 = document.querySelector('h1');
  if (h1 && isUsableTitle(h1.textContent)) return h1.textContent.trim();

  // 4. Fallback: raw document.title
  return document.title || 'Untitled';
}

// ── URL-based pageId (SHA-256 prefix of normalized URL) ─────────────

async function urlHash() {
  const url = new URL(window.location.href);
  url.hash = ''; // strip fragment to prevent duplicate entries
  const normalized = url.origin + url.pathname.replace(/\/+$/, '');
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'web_' + hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Send to background ──────────────────────────────────────────────

function sendUpsert(pageId, title) {
  const source = detectSource();
  chrome.runtime.sendMessage({
    action: 'upsertPageEntry',
    pageId,
    title,
    url: window.location.href,
    source,
    tokenSnapshot: 0,
    properties: null,
  }).catch(() => {});
}

// ── Main tracking entry point ───────────────────────────────────────

async function trackPage() {
  const pageId = await urlHash();
  if (!pageId) return;

  const title = getPageTitle();
  sendUpsert(pageId, title);

  // For Untitled pages, retry once after 3s
  if (!isUsableTitle(title)) {
    setTimeout(async () => {
      const retryTitle = getPageTitle();
      if (isUsableTitle(retryTitle)) {
        chrome.runtime.sendMessage({
          action: 'patchPageTitle',
          pageId,
          title: retryTitle,
          properties: null,
        }).catch(() => {});
      }
    }, 3000);
  }
}

// ── SPA navigation detection ────────────────────────────────────────

let lastUrl = window.location.href;

function checkNavigation() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    // Wait for new page to settle then track
    setTimeout(trackPage, 1000);
  }
}

setInterval(checkNavigation, 3000);

// ── Initial load ────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', trackPage);
} else {
  // Give dynamic SPA apps a moment to set the real title
  setTimeout(trackPage, 500);
}
