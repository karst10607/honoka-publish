/**
 * Capture tests — fake Playwright browser for unit coverage, plus a real
 * Chromium capture of example.com that skips when the browser binary is
 * unavailable (CI). Run: npm test
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { capturePage, matchRule, loadSiteRules } = require("../src/integrations/capture");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-capture-test-"));
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

// ── Site rules ──

test("site rules ship a 591 rule and match its hosts", () => {
  const rules = loadSiteRules();
  assert.ok(rules.some((r) => r.id === "591"));
  assert.equal(matchRule("rent.591.com.tw")?.id, "591");
  assert.equal(matchRule("www.591.com.tw")?.id, "591");
  assert.equal(matchRule("example.com"), null);
  assert.equal(matchRule("not591.com.tw"), null);
});

// ── Fake Playwright ──

function fakeChromium({ dataLayer, failLaunch = false } = {}) {
  const calls = { launch: 0, goto: [], screenshots: [], closes: 0 };
  const document = {
    title: "Fake Page Title",
    body: { scrollHeight: 800 },
    querySelector(selector) {
      if (selector === "h1") return { innerText: "Fake H1" };
      if (selector.startsWith("meta")) return { getAttribute: () => "Fake meta description" };
      return null;
    },
  };
  const window = { dataLayer: dataLayer || [], scrollBy() {} };
  const page = {
    async goto(url, opts) { calls.goto.push({ url, opts }); },
    async waitForLoadState() {},
    async waitForTimeout() {},
    async evaluate(fn, arg) {
      const prevDoc = globalThis.document;
      const prevWin = globalThis.window;
      globalThis.document = document;
      globalThis.window = window;
      try {
        return await fn(arg);
      } finally {
        globalThis.document = prevDoc;
        globalThis.window = prevWin;
      }
    },
    async screenshot({ path: pngPath, fullPage }) {
      fs.mkdirSync(path.dirname(pngPath), { recursive: true });
      fs.writeFileSync(pngPath, PNG_BYTES);
      calls.screenshots.push({ pngPath, fullPage });
    },
  };
  const chromium = {
    async launch() {
      calls.launch += 1;
      if (failLaunch) throw new Error("Executable doesn't exist at /root/.cache/ms-playwright/chromium-1234");
      return {
        async newContext() { return { async newPage() { return page; } }; },
        async close() { calls.closes += 1; },
      };
    },
  };
  return { chromium, calls };
}

test("capturePage degrades cleanly when playwright is unavailable", async () => {
  const result = await capturePage("https://example.com", {
    outputDir: path.join(TMP, "unavailable"),
    deps: { chromium: null },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /playwright not installed/);
});

test("capturePage degrades when the chromium binary is missing", async () => {
  const fake = fakeChromium({ failLaunch: true });
  const result = await capturePage("https://example.com", {
    outputDir: path.join(TMP, "no-binary"),
    deps: { chromium: fake.chromium },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /doesn't exist/);
  assert.equal(fake.calls.closes, 0);
});

test("generic capture screenshots the full page and extracts metadata", async () => {
  const fake = fakeChromium();
  const outputDir = path.join(TMP, "generic");
  const result = await capturePage("https://example.com/post", { outputDir, deps: { chromium: fake.chromium } });
  assert.equal(result.ok, true);
  assert.equal(result.ruleId, undefined);
  assert.equal(result.data.title, "Fake Page Title");
  assert.equal(result.data.heading, "Fake H1");
  assert.equal(result.data.description, "Fake meta description");
  assert.ok(result.pngPath.startsWith(outputDir));
  assert.ok(fs.statSync(result.pngPath).size > 0);
  assert.equal(fake.calls.screenshots.length, 1);
  assert.equal(fake.calls.screenshots[0].fullPage, true);
  assert.equal(fake.calls.closes, 1);
});

test("site-rule capture extracts 591 dataLayer fields", async () => {
  const fake = fakeChromium({
    dataLayer: [{
      price_name: "15000元/月",
      area_name: "12坪",
      floor_name: "3F",
      layout_name: "2房1廳",
      community_name: "信義區",
    }],
  });
  const result = await capturePage("https://rent.591.com.tw/rent-detail-123.html", {
    outputDir: path.join(TMP, "591"),
    deps: { chromium: fake.chromium },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ruleId, "591");
  assert.equal(result.data.price, "15000元/月");
  assert.equal(result.data.ping, "12坪");
  assert.equal(result.data.floor, "3F");
  assert.equal(result.data.layout, "2房1廳");
  assert.equal(result.data.community, "信義區");
});

test("real Chromium: captures example.com full page (local only)", async (t) => {
  let chromium;
  try {
    chromium = require("playwright").chromium;
  } catch {
    return t.skip("playwright not installed");
  }
  const result = await capturePage("https://example.com", {
    outputDir: path.join(TMP, "real"),
    timeoutMs: 60000,
  });
  if (!result.ok) {
    return t.skip(`chromium/browser unavailable: ${result.reason.slice(0, 120)}`);
  }
  const size = fs.statSync(result.pngPath).size;
  assert.ok(size > 1000, `screenshot too small: ${size} bytes`);
  console.log(`[integration] example.com captured → ${result.pngPath} (${size} bytes)`);
});