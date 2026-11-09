/**
 * Event bus + /events SSE tests: payload scrubbing, ring replay, endpoint
 * auth/streaming, and pipeline emissions. Run: npm test
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-events-test-"));
process.env.HONOKA_DIR = TMP;

const { emitEvent, subscribe, replaySince, resetEvents } = require("../src/events");
const { createServer } = require("../src/bridge");
const { processUrl } = require("../src/integrations/url-pipeline");

const SETTINGS_FILE = path.join(TMP, ".honoka", "bridge-settings.json");
let server;
let port;
let token;

function listen(s) {
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(s.address().port)));
}

function sseClient({ authToken = token, lastEventId } = {}) {
  const events = [];
  let buffer = "";
  const options = {
    host: "127.0.0.1",
    port,
    path: `/events?token=${encodeURIComponent(authToken)}`,
    headers: lastEventId ? { "Last-Event-ID": lastEventId } : {},
  };
  const req = http.get(options, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = {};
        for (const line of block.split("\n")) {
          if (line.startsWith("id: ")) event.id = line.slice(4);
          else if (line.startsWith("event: ")) event.type = line.slice(7);
          else if (line.startsWith("data: ")) event.data = JSON.parse(line.slice(6));
        }
        if (event.type) events.push(event);
      }
    });
  });
  async function waitFor(type, timeoutMs = 3000) {
    const started = Date.now();
    for (;;) {
      const hit = events.find((event) => event.type === type);
      if (hit) return hit;
      if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${type}; got ${events.map((e) => e.type).join(",")}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return { events, waitFor, close: () => req.destroy() };
}

before(async () => {
  resetEvents();
  server = createServer();
  port = await listen(server);
  token = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")).bridgeToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("emitEvent scrubs token query values from payloads", () => {
  const event = emitEvent({
    type: "url_received",
    url: "https://example.com/a?token=SUPERSECRET&x=1",
    nested: { note: "token=OTHER123" },
  });
  assert.ok(!JSON.stringify(event).includes("SUPERSECRET"));
  assert.ok(!JSON.stringify(event).includes("OTHER123"));
  assert.ok(event.url.includes("token=***"));
  assert.match(event.id, /^\d+$/);
});

test("replaySince returns only newer events", () => {
  resetEvents();
  const first = emitEvent({ type: "url_received", url: "https://a.example/1" });
  const second = emitEvent({ type: "note_saved", url: "https://a.example/2", title: "T" });
  assert.deepEqual(replaySince(String(first.id)).map((e) => e.id), [second.id]);
  assert.equal(replaySince().length, 2);
  assert.equal(replaySince("999").length, 0);
});

test("/events requires the bridge token", async () => {
  const status = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/events?token=wrong" }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject);
  });
  assert.equal(status, 401);
});

test("/events streams live events and replays by Last-Event-ID", async () => {
  resetEvents();
  const client = sseClient();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const live = emitEvent({ type: "url_received", url: "https://example.com/live", kind: "article" });
  const frame = await client.waitFor("url_received");
  assert.equal(frame.id, live.id);
  assert.equal(frame.data.url, "https://example.com/live");
  client.close();

  const replay = sseClient({ lastEventId: live.id });
  try {
    const later = emitEvent({ type: "note_saved", url: "https://example.com/live", title: "Later" });
    const frame2 = await replay.waitFor("note_saved");
    assert.equal(frame2.id, later.id);
    assert.ok(!replay.events.some((event) => event.type === "url_received"), "replayed event must be filtered by Last-Event-ID");
  } finally {
    replay.close();
  }
});

test("article pipeline emits url_received then error (Joplin down)", async () => {
  resetEvents();
  const seen = [];
  const unsubscribe = subscribe((event) => seen.push(event.type));
  const article = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><head><title>Event Article</title></head><body><article><h1>H</h1><p>Body text for the article that is long enough to be parsed, with commas, clauses, and words.</p></article></body></html>");
  });
  const articlePort = await listen(article);
  try {
    const result = await processUrl(`http://127.0.0.1:${articlePort}/post`, {
      honokaDir: TMP,
      settings: { joplinApiUrl: "http://127.0.0.1:1", joplinToken: "secret-token" },
      deps: { capturePage: null },
    });
    assert.equal(result.ok, false);
    assert.equal(seen[0], "url_received");
    assert.ok(seen.includes("error"));
    assert.ok(!seen.includes("note_saved"));
  } finally {
    unsubscribe();
    await new Promise((resolve) => article.close(resolve));
  }
});

test("video pipeline emits download_progress then note_saved", async () => {
  resetEvents();
  const seen = [];
  const unsubscribe = subscribe((event) => seen.push(event));
  const joplinRequests = [];
  const joplin = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      joplinRequests.push({ route: req.url.split("?")[0], raw: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "note_evt_1" }));
    });
  });
  const joplinPort = await listen(joplin);
  const fakeDownload = async (url, { outputDir }) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = "video-2026-01-01T00-00-00-000Z-Event_Clip.mp4";
    fs.writeFileSync(path.join(outputDir, filename), Buffer.alloc(1024));
    return { success: true, filename };
  };
  try {
    const result = await processUrl("https://youtu.be/event", {
      honokaDir: TMP,
      settings: { joplinApiUrl: `http://127.0.0.1:${joplinPort}`, joplinToken: "t", joplinNotebookId: "nb" },
      deps: { downloadVideo: fakeDownload },
    });
    assert.equal(result.ok, true);
    assert.equal(seen[0].type, "url_received");
    assert.ok(seen.some((e) => e.type === "note_saved" && e.noteId === "note_evt_1" && e.title === "Event Clip"));
    assert.ok(!seen.some((e) => e.type === "download_progress"), "direct download mock reports no progress without onProgress calls");
  } finally {
    unsubscribe();
    await new Promise((resolve) => joplin.close(resolve));
  }
});

test("download progress callbacks emit throttled progress events", async () => {
  resetEvents();
  const seen = [];
  const unsubscribe = subscribe((event) => seen.push(event));
  const joplin = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "note_prog_1" }));
    });
  });
  const joplinPort = await listen(joplin);
  const fakeDownload = async (url, { outputDir, onProgress }) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = "video-2026-01-01T00-00-00-000Z-Progress.mp4";
    fs.writeFileSync(path.join(outputDir, filename), Buffer.alloc(1024));
    onProgress("10%");
    onProgress("12%");   // same 10% step → suppressed
    onProgress("55%");
    onProgress("100%");
    return { success: true, filename };
  };
  try {
    const result = await processUrl("https://youtu.be/progress", {
      honokaDir: TMP,
      settings: { joplinApiUrl: `http://127.0.0.1:${joplinPort}`, joplinToken: "t", joplinNotebookId: "nb" },
      deps: { downloadVideo: fakeDownload },
    });
    assert.equal(result.ok, true);
    const progress = seen.filter((e) => e.type === "download_progress").map((e) => e.progress);
    assert.deepEqual(progress, [10, 55, 100]);
  } finally {
    unsubscribe();
    await new Promise((resolve) => joplin.close(resolve));
  }
});