/**
 * Honoka Page Tracker — auto-records Notion page visits.
 * Injected via content_scripts on Notion pages (see manifest.json).
 *
 * - Detects page navigation (Notion is an SPA)
 * - Extracts page ID, title, URL from the DOM
 * - Sends tracking data to background.js for storage
 * - Retries "Untitled" pages after a short delay
 */

// ── Page ID extraction ──────────────────────────────────────────────

function getNotionPageId() {
  const params = new URLSearchParams(window.location.search);
  const peekId = params.get("p");
  if (peekId && /^[a-f0-9]{32}$/.test(peekId)) return peekId;
  if (peekId && /^[a-f0-9-]{36}$/.test(peekId)) return peekId.replace(/-/g, "");

  const path = window.location.pathname;
  const match = path.match(/([a-f0-9]{32})(?:[?#]|$)/);
  if (match) return match[1];
  const match2 = path.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  return match2 ? match2[1].replace(/-/g, "") : null;
}

function isUsableTitle(t) {
  if (!t || t === "Untitled") return false;
  const stripped = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\u200d\ufe0f]/gu, "");
  return stripped.length > 0;
}

function getNotionPageTitle() {
  const selectors = [
    '[placeholder="Untitled"]',
    "h1.notranslate",
    '[data-block-id] h1',
    ".notion-selectable.notion-page-block",
    ".notion-page-block",
    '[contenteditable="true"][data-root="true"]',
    ".notion-page-block .notranslate",
  ];

  function extractFrom(root) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const t = (el.textContent || "").trim();
      if (isUsableTitle(t)) return t;
    }
    return null;
  }

  // Peek mode
  const peek = document.querySelector(".notion-peek-renderer");
  if (peek) {
    const t = extractFrom(peek);
    if (t) return t;
  }

  // Normal page
  const t = extractFrom(document);
  if (t) return t;

  // Fallback 1: document.title
  const titleMatch = document.title.match(/^(.+?)(?:\s*[|–—]\s*Notion)?$/);
  const docTitle = titleMatch ? titleMatch[1].trim() : document.title;
  if (isUsableTitle(docTitle)) return docTitle;

  // Fallback 2: URL slug
  const urlTitle = extractTitleFromUrl();
  if (urlTitle) return urlTitle;

  return null;
}

function extractTitleFromUrl() {
  const url = decodeURIComponent(window.location.href);
  const match = url.match(/(?:notion\.so|notion\.com)\/(?:[^/]+\/)?(.+)-[a-f0-9]{32}(?:\?|$)/);
  if (match) {
    return match[1].replace(/-/g, " ").trim();
  }
  return null;
}

// ── Page properties extraction ──────────────────────────────────────

const KNOWN_PROP_NAMES = new Set([
  "status", "type", "tag", "tags", "priority", "reviewer", "reviewers",
  "member", "members", "assignee", "assignees", "owner", "author",
  "created", "created by", "created time", "last edited", "last edited by",
  "last edited time", "due", "due date", "date", "sprint", "team",
  "category", "label", "labels", "project", "epic", "component",
  "description", "summary", "notes", "url", "link", "email", "phone",
  "company", "department", "role", "stage", "phase", "version",
]);

function extractPairFromRow(row) {
  const children = row.children;
  if (children.length < 2) return null;

  const nameEl = children[0];
  const valueEl = children[1];
  const name = (nameEl.textContent || "").trim();
  const value = (valueEl.textContent || "").trim();

  if (!name || !value) return null;
  if (name.length > 50 || name.length < 1) return null;
  if (name.split(/\s+/).length > 5) return null;
  if (value.length > 500) return null;

  const nameLower = name.toLowerCase();
  if (KNOWN_PROP_NAMES.has(nameLower) || name.split(/\s+/).length <= 3) {
    return [name, value];
  }
  return null;
}

function extractPageProperties() {
  const props = {};
  const peek = document.querySelector(".notion-peek-renderer");
  const scope = peek || document;

  const selectorSets = [
    '.notion-collection-page-properties .notion-collection-property',
    '[class*="property-row"]',
    '[class*="collection_page_properties"] [class*="property"]',
    '[class*="page-properties"] [class*="row"]',
    '[class*="page_properties"] [class*="row"]',
  ];

  for (const sel of selectorSets) {
    const rows = scope.querySelectorAll(sel);
    rows.forEach((row) => {
      const pair = extractPairFromRow(row);
      if (pair) props[pair[0]] = pair[1];
    });
    if (Object.keys(props).length > 0) break;
  }

  return Object.keys(props).length > 0 ? props : null;
}

// ── Send to background ──────────────────────────────────────────────

function sendUpsert(pageId, title, properties) {
  chrome.runtime.sendMessage({
    action: "upsertPageEntry",
    pageId,
    title,
    url: window.location.href,
    tokenSnapshot: 0,
    properties: properties || null,
    extras: null,
  }).catch(() => {});
}

function sendPatchTitle(pageId, title, properties) {
  chrome.runtime.sendMessage({
    action: "patchPageTitle",
    pageId,
    title,
    properties: properties || null,
  }).catch(() => {});
}

// ── Main tracking entry point ───────────────────────────────────────

function trackPage() {
  const pageId = getNotionPageId();
  if (!pageId) return;

  const title = getNotionPageTitle();
  const properties = extractPageProperties();

  sendUpsert(pageId, title, properties);

  if (!title || title === "Untitled") {
    // Retry after 2s (Notion may still be rendering)
    setTimeout(() => {
      const retryTitle = getNotionPageTitle();
      const retryProps = extractPageProperties();
      if (retryTitle && retryTitle !== "Untitled") {
        sendPatchTitle(pageId, retryTitle, retryProps);
      } else {
        // Fallback: Chrome browsing history
        chrome.runtime.sendMessage(
          { action: "getTitleFromHistory", url: window.location.href, pageId },
          (resp) => {
            if (chrome.runtime.lastError) return;
            if (resp?.title) sendPatchTitle(pageId, resp.title, null);
          }
        );
      }
    }, 2000);
  }
}

// ── Wait for Notion content to render ───────────────────────────────

function getNotionContainer() {
  const peek =
    document.querySelector(".notion-peek-renderer .notion-page-content") ||
    document.querySelector(".notion-peek-renderer .notion-scroller");
  if (peek) return peek;

  return (
    document.querySelector(".notion-page-content") ||
    document.querySelector('[role="document"]') ||
    document.querySelector(".notion-scroller") ||
    document.body
  );
}

function waitForContent(onReady) {
  let attempts = 0;
  const check = setInterval(() => {
    attempts++;
    const container = getNotionContainer();
    const blocks = container.querySelectorAll("[data-block-id]");
    if (blocks.length > 0) {
      clearInterval(check);
      onReady();
    }
    if (attempts > 30) clearInterval(check);
  }, 500);
}

function onPageReady() {
  trackPage();
}

// ── SPA navigation detection (Notion is an SPA) ─────────────────────

let lastUrl = window.location.href;
let lastPeekState = false;

function checkNavigation() {
  const currentUrl = window.location.href;
  const hasPeek = !!document.querySelector(".notion-peek-renderer");

  const urlChanged = currentUrl !== lastUrl;
  const peekOpened = hasPeek && !lastPeekState;
  const peekClosed = !hasPeek && lastPeekState;

  if (urlChanged || peekOpened || peekClosed) {
    lastUrl = currentUrl;
    lastPeekState = hasPeek;
    waitForContent(onPageReady);
  }
}

setInterval(checkNavigation, 1000);

// ── Initial load ────────────────────────────────────────────────────

waitForContent(onPageReady);
