/**
 * Full-page capture — headless Chromium screenshot plus data-driven site
 * rules (ported from honoka-lite's capture.js). Playwright is optional: when
 * the package or its browser binary is missing, capturePage resolves
 * { ok: false, reason } instead of throwing, so callers degrade to a
 * text-only note.
 */
const fs = require("fs");
const path = require("path");

const RULES_FILE = path.join(__dirname, "capture-rules.json");
const DEFAULT_TIMEOUT_MS = 45000;
const VIEWPORT = { width: 1280, height: 800 };
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function loadSiteRules() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch {
    return [];
  }
}

function matchRule(host, rules = loadSiteRules()) {
  const clean = String(host || "").toLowerCase().replace(/^www\./, "");
  return rules.find((rule) =>
    (rule.hosts || []).some((h) => clean === h || clean.endsWith(`.${h}`))
  ) || null;
}

async function resolveChromium(deps) {
  if (deps && "chromium" in deps) return deps.chromium;
  try {
    return require("playwright").chromium;
  } catch {
    return null;
  }
}

/** In-page extraction: selectors and dataLayer mapping come from the rules file (plain data, no eval'd code). */
async function extractInPage(page, cfg) {
  return page.evaluate((conf) => {
    const out = {};
    try {
      if (conf.dataLayer) {
        const item = (window.dataLayer || []).find((x) => x && x[conf.dataLayer.find]);
        if (item) {
          for (const [key, source] of Object.entries(conf.dataLayer.map)) {
            if (item[source] !== undefined) out[key] = item[source];
          }
        }
      }
      for (const [key, selectors] of Object.entries(conf.fields || {})) {
        if (out[key]) continue;
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText && el.innerText.trim()) {
            out[key] = el.innerText.trim();
            break;
          }
        }
      }
      if (conf.generic) {
        if (!out.title) out.title = document.title || "";
        const h1 = document.querySelector("h1");
        if (!out.heading && h1 && h1.innerText) out.heading = h1.innerText.trim();
        const desc = document.querySelector('meta[name="description"], meta[property="og:description"]');
        if (!out.description && desc) out.description = (desc.getAttribute("content") || "").trim();
      }
    } catch { /* extraction is best-effort */ }
    return out;
  }, cfg);
}

async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      let steps = 0;
      const timer = setInterval(() => {
        const height = document.body.scrollHeight;
        window.scrollBy(0, 400);
        total += 400;
        steps += 1;
        if (total >= height || steps >= 40) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
}

/**
 * Capture a full-page screenshot (and site-rule data) into outputDir.
 * Never throws: browser/playwright problems resolve to { ok: false }.
 * @returns {Promise<{ok:boolean, pngPath?:string, data?:object, ruleId?:string, reason?:string}>}
 */
async function capturePage(url, { outputDir, deps = {}, timeoutMs = DEFAULT_TIMEOUT_MS, scroll = true } = {}) {
  const chromium = await resolveChromium(deps);
  if (!chromium) {
    return { ok: false, reason: "playwright not installed (npm install playwright && npx playwright install chromium)" };
  }
  fs.mkdirSync(outputDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: VIEWPORT, userAgent: USER_AGENT });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    if (scroll) {
      await scrollToBottom(page).catch(() => {});
      await page.waitForTimeout(1000);
    }

    const rule = matchRule(new URL(url).hostname);
    const data = await extractInPage(page, rule ? { ...rule.extract, generic: true } : { generic: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pngPath = path.join(outputDir, `capture-${stamp}.png`);
    await page.screenshot({ path: pngPath, fullPage: true });

    return { ok: true, pngPath, data, ruleId: rule ? rule.id : undefined };
  } catch (err) {
    return { ok: false, reason: String(err.message || err).slice(0, 200) };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  }
}

module.exports = { capturePage, matchRule, loadSiteRules, RULES_FILE };