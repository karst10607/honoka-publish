/**
 * Content script for page clipping — clean-room implementation.
 * Injected into all pages to enable clipping functionality.
 */

// Listen for clip requests from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'clipPage') {
    clipCurrentPage().then(sendResponse).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true; // keep channel open for async response
  }
});

/** Main clipping function: extract article + convert to Markdown. */
async function clipCurrentPage() {
  const url = window.location.href;
  const title = document.title;

  // Extract article content
  const { content, excerpt } = extractArticle();

  if (!content) {
    throw new Error('Could not extract meaningful content from this page');
  }

  // Convert extracted HTML to Markdown
  const { htmlToMarkdown } = await import(chrome.runtime.getURL('src/lib/markdown.js'));
  const markdown = htmlToMarkdown(content);

  // Build frontmatter
  const now = new Date().toISOString();
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `url: ${url}`,
    `clipped: ${now}`,
    excerpt ? `excerpt: "${excerpt.replace(/"/g, '\\"').slice(0, 200)}"` : '',
    '---',
    '',
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    title,
    url,
    markdown: frontmatter + markdown,
    excerpt: excerpt || '',
  };
}

/**
 * Lightweight article extraction — clean-room implementation.
 * Finds the main content area of the page without using Mozilla's Readability library.
 */
function extractArticle() {
  // Strategy: find the best candidate container
  const candidates = [];

  // Priority 1: Semantic HTML5 elements
  for (const tag of ['article', 'main', '[role="main"]']) {
    const el = document.querySelector(tag);
    if (el && hasSubstantialText(el)) {
      return {
        content: cleanupContent(el.innerHTML),
        excerpt: getExcerpt(el),
      };
    }
  }

  // Priority 2: Common class/id patterns
  const selectors = [
    '.post-content', '.entry-content', '.article-content',
    '.post-body', '.entry-body', '.content-body',
    '#article', '#content', '#post-content',
    '.markdown-body', '.prose', '.document-content',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && hasSubstantialText(el)) {
      return {
        content: cleanupContent(el.innerHTML),
        excerpt: getExcerpt(el),
      };
    }
  }

  // Priority 3: Largest container heuristic
  const bodies = document.querySelectorAll('body');
  if (bodies.length > 0) {
    const body = bodies[0];
    const best = findBestContainer(body);
    if (best) {
      return {
        content: cleanupContent(best.innerHTML),
        excerpt: getExcerpt(best),
      };
    }
  }

  // Fallback: use body content
  const body = document.body;
  return {
    content: cleanupContent(body.innerHTML),
    excerpt: getExcerpt(body),
  };
}

/** Find the container with the most text content. */
function findBestContainer(root) {
  const containers = root.querySelectorAll('div, section, td');
  let best = null;
  let bestLength = 0;

  for (const el of containers) {
    // Skip if matches exclude patterns
    if (el.closest('nav, header, footer, .sidebar, .nav, .menu, .footer')) continue;

    const textLen = el.textContent.trim().length;
    if (textLen > bestLength) {
      bestLength = textLen;
      best = el;
    }
  }

  return best;
}

/** Check if element has substantial text content. */
function hasSubstantialText(el) {
  const text = el.textContent.trim();
  // Must have more than 100 chars of visible text
  return text.length > 100 && text.length < 500000; // also skip extremely large
}

/** Get a short excerpt from an element. */
function getExcerpt(el) {
  const text = el.textContent.trim();
  return text.slice(0, 300).replace(/\s+/g, ' ').trim();
}

/** Clean up content: remove non-content elements while preserving structure. */
function cleanupContent(html) {
  // Remove scripts, styles, nav elements, etc.
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
