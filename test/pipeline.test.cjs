/**
 * URL pipeline tests — classifier, article extraction, video/article flow,
 * retry + inbox fallback, size cap, progress throttling. All external effects
 * are mocked (yt-dlp via deps injection, Joplin + article source via local
 * HTTP servers). Run: npm test
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { classifyUrl, extractArticle, processUrl, formatReply } = require("../src/integrations/url-pipeline");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-pipeline-test-"));
const HONOKA_DIR = path.join(TMP, "honoka");
fs.mkdirSync(HONOKA_DIR, { recursive: true });

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── Mock servers ──

function startMockJoplin() {
  const requests = [];
  let counter = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, route: url.pathname, raw });
      if (url.pathname === "/notes" && req.method === "POST") {
        counter += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ id: `note_${counter}`, ...JSON.parse(raw) }));
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function startArticleServer(htmlByPath) {
  const server = http.createServer((req, res) => {
    const html = htmlByPath[req.url];
    if (html === undefined) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const ARTICLE_HTML = `<!DOCTYPE html><html><head>
<title>Site Title - Test Article</title>
<meta property="og:title" content="OG Test Article">
<script>var tracking = "SHOULD_NOT_APPEAR";</script>
<style>.nav { color: red; }</style>
</head><body>
<nav>NAVIGATION_SHOULD_NOT_APPEAR</nav>
<article>
<h1>Test Article Heading</h1>
<p>This is the first paragraph of the article body, it contains enough text to be considered readable content by the extraction algorithm, with several clauses, commas, and more words to reach a reasonable length for scoring.</p>
<p>This is the second paragraph, it also contains plenty of text, more clauses, and additional words so that the readability parser scores the article container highly enough to select it as the main content.</p>
<p>A third paragraph adds even more body text, with commas, clauses, and a zebrafish marker that the test asserts appears in the resulting markdown output.</p>
</article>
<footer>FOOTER_SHOULD_NOT_APPEAR</footer>
</body></html>`;

const FALLBACK_HTML = `<html><head><title>Fallback Page Title</title>
<meta name="description" content="A short meta description for fallback.">
</head><body></body></html>`;

// ── Classifier ──

test("classifyUrl marks video platforms as video", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "https://www.bilibili.com/video/BV1",
    "https://b23.tv/abc",
    "https://twitter.com/user/status/1",
    "https://x.com/user/status/1",
    "https://m.youtube.com/watch?v=abc",
    "https://vimeo.com/123",
  ]) {
    assert.equal(classifyUrl(url).kind, "video", url);
  }
});

test("classifyUrl marks other and invalid URLs as article", () => {
  assert.equal(classifyUrl("https://example.com/blog/post").kind, "article");
  assert.equal(classifyUrl("https://news.ycombinator.com/item?id=1").kind, "article");
  assert.equal(classifyUrl("not a url").kind, "article");
  assert.equal(classifyUrl("https://notyoutube.com.evil.example/x").kind, "article");
});

// ── Article extraction ──

test("extractArticle pulls readable content and strips chrome", async () => {
  const server = await startArticleServer({ "/post": ARTICLE_HTML });
  try {
    const { title, markdown } = await extractArticle(`${server.base}/post`);
    assert.ok(title.length > 0);
    assert.ok(markdown.includes("zebrafish marker"));
    assert.ok(!markdown.includes("SHOULD_NOT_APPEAR"));
    assert.ok(!markdown.includes("NAVIGATION_SHOULD_NOT_APPEAR"));
    assert.ok(!markdown.includes("FOOTER_SHOULD_NOT_APPEAR"));
  } finally {
    await server.close();
  }
});

test("extractArticle falls back to title + description when no article body", async () => {
  const server = await startArticleServer({ "/empty": FALLBACK_HTML });
  try {
    const { title, markdown } = await extractArticle(`${server.base}/empty`);
    assert.equal(title, "Fallback Page Title");
    assert.ok(markdown.includes("A short meta description for fallback."));
  } finally {
    await server.close();
  }
});

test("extractArticle rejects on HTTP error", async () => {
  const server = await startArticleServer({});
  try {
    await assert.rejects(() => extractArticle(`${server.base}/missing`), /HTTP 404/);
  } finally {
    await server.close();
  }
});

// ── Video pipeline ──

function fakeDownload({ filename = "video-2026-01-01T00-00-00-000Z-My_Clip.mp4", bytes = 1024, failTimes = 0, onCall } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    fn: async (url, opts) => {
      calls += 1;
      if (onCall) onCall(url, opts, calls);
      if (calls <= failTimes) throw new Error("yt-dlp mock failure");
      fs.mkdirSync(opts.outputDir, { recursive: true });
      fs.writeFileSync(path.join(opts.outputDir, filename), Buffer.alloc(bytes));
      if (opts.onProgress) {
        opts.onProgress("10%");
        opts.onProgress("55%");
        opts.onProgress("100%");
      }
      return { success: true, filename };
    },
  };
}

test("video URL downloads, references local path, and creates Joplin note", async () => {
  const joplin = await startMockJoplin();
  const dl = fakeDownload();
  const notifications = [];
  try {
    const result = await processUrl("https://youtube.com/watch?v=abc", {
      honokaDir: HONOKA_DIR,
      settings: { joplinApiUrl: joplin.url, joplinToken: "t", joplinNotebookId: "nb" },
      notify: async (text) => { notifications.push(text); },
      deps: { downloadVideo: dl.fn },
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "video");
    assert.equal(result.noteId, "note_1");
    assert.equal(dl.calls(), 1);
    assert.ok(fs.existsSync(result.videoPath));
    assert.equal(result.title, "My Clip");
    const noteReq = joplin.requests.find((r) => r.route === "/notes");
    const payload = JSON.parse(noteReq.raw);
    assert.ok(payload.body.includes(result.videoPath));
    assert.ok(payload.body.includes("Source: https://youtube.com/watch?v=abc"));
    assert.ok(notifications.some((n) => n.includes("Video detected")));
    assert.ok(notifications.some((n) => n.includes("100%")));
    assert.ok(notifications.filter((n) => n.includes("Downloading")).length <= 11);
  } finally {
    await joplin.close();
  }
});

test("video download retries once then succeeds", async () => {
  const joplin = await startMockJoplin();
  const dl = fakeDownload({ failTimes: 1 });
  try {
    const result = await processUrl("https://youtu.be/abc", {
      honokaDir: HONOKA_DIR,
      settings: { joplinApiUrl: joplin.url, joplinToken: "t", joplinNotebookId: "nb" },
      deps: { downloadVideo: dl.fn },
    });
    assert.equal(result.ok, true);
    assert.equal(dl.calls(), 2);
  } finally {
    await joplin.close();
  }
});

test("video failure after retry lands in inbox with reason", async () => {
  const dl = fakeDownload({ failTimes: 99 });
  const result = await processUrl("https://x.com/u/status/1", {
    honokaDir: HONOKA_DIR,
    settings: {},
    deps: { downloadVideo: dl.fn },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "download");
  assert.equal(dl.calls(), 2);
  assert.ok(fs.existsSync(result.inboxPath));
  const content = fs.readFileSync(result.inboxPath, "utf8");
  assert.ok(content.includes("https://x.com/u/status/1"));
  assert.ok(content.includes("yt-dlp mock failure"));
});

test("video exceeding size cap is deleted and queued to inbox", async () => {
  const dl = fakeDownload({ bytes: 4096 });
  const result = await processUrl("https://youtube.com/watch?v=big", {
    honokaDir: HONOKA_DIR,
    settings: { videoMaxSizeMB: 0.001 },
    deps: { downloadVideo: dl.fn },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds size limit/);
  const videoDir = path.join(HONOKA_DIR, "Videos");
  const leftover = fs.existsSync(videoDir) ? fs.readdirSync(videoDir) : [];
  assert.equal(leftover.length, 0);
  assert.ok(fs.existsSync(result.inboxPath));
});

test("custom videoDir setting is honored", async () => {
  const joplin = await startMockJoplin();
  const customDir = path.join(TMP, "custom-videos");
  const dl = fakeDownload();
  try {
    const result = await processUrl("https://youtube.com/watch?v=abc", {
      honokaDir: HONOKA_DIR,
      settings: { videoDir: customDir, joplinApiUrl: joplin.url, joplinToken: "t", joplinNotebookId: "nb" },
      deps: { downloadVideo: dl.fn },
    });
    assert.equal(result.ok, true);
    assert.ok(result.videoPath.startsWith(customDir));
  } finally {
    await joplin.close();
  }
});

// ── Article pipeline ──

test("article URL extracts and saves a Joplin note", async () => {
  const joplin = await startMockJoplin();
  const article = await startArticleServer({ "/post": ARTICLE_HTML });
  try {
    const url = `${article.base}/post`;
    const result = await processUrl(url, {
      honokaDir: HONOKA_DIR,
      settings: { joplinApiUrl: joplin.url, joplinToken: "t", joplinNotebookId: "nb" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "article");
    const noteReq = joplin.requests.find((r) => r.route === "/notes");
    const payload = JSON.parse(noteReq.raw);
    assert.ok(payload.body.includes("zebrafish marker"));
    assert.ok(payload.body.includes(`Source: ${url}`));
  } finally {
    await article.close();
    await joplin.close();
  }
});

test("Joplin unreachable falls back to inbox (article)", async () => {
  const article = await startArticleServer({ "/post": ARTICLE_HTML });
  try {
    const result = await processUrl(`${article.base}/post`, {
      honokaDir: HONOKA_DIR,
      settings: { joplinApiUrl: "http://127.0.0.1:1", joplinToken: "secret-token", joplinNotebookId: "nb" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.fallback, "inbox");
    assert.ok(fs.existsSync(result.inboxPath));
    assert.ok(!result.error.includes("secret-token"));
    const content = fs.readFileSync(result.inboxPath, "utf8");
    assert.ok(!content.includes("secret-token"));
    assert.ok(content.includes("zebrafish marker"));
  } finally {
    await article.close();
  }
});

test("article fetch failure after retry lands in inbox", async () => {
  const article = await startArticleServer({});
  try {
    const result = await processUrl(`${article.base}/missing`, {
      honokaDir: HONOKA_DIR,
      settings: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "extract");
    assert.ok(fs.existsSync(result.inboxPath));
  } finally {
    await article.close();
  }
});

// ── Reply formatting ──

test("formatReply covers success, inbox fallback, and failure", () => {
  assert.match(formatReply({ ok: true, title: "T", noteId: "n1" }), /Saved to Joplin.*n1/);
  assert.match(formatReply({ ok: true, title: "T", noteId: "n1", videoPath: "/v.mp4" }), /\/v\.mp4/);
  assert.match(formatReply({ ok: false, fallback: "inbox", inboxPath: "/i.md", error: "down" }), /queued in inbox/);
  assert.match(formatReply({ ok: false, stage: "download", inboxPath: "/i.md", error: "boom" }), /Failed after retry \(download\)/);
});