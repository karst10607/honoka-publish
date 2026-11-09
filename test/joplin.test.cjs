/**
 * Joplin integration tests — mock HTTP unit tests always run; the real-Joplin
 * integration test only runs when local bridge settings contain joplinToken
 * (skipped in CI). Run: npm test
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { createClient, saveToJoplin, redactUrl } = require("../src/integrations/joplin");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-joplin-test-"));
const INBOX = path.join(TMP, "inbox");

// 1x1 transparent PNG fixture for resource upload tests.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_PATH = path.join(TMP, "pixel.png");
fs.writeFileSync(PNG_PATH, PNG_1PX);

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Minimal Joplin API mock recording every request. */
function startMock({ failNotes = false } = {}) {
  const requests = [];
  let noteCounter = 0;
  let resourceCounter = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, route: url.pathname, token: url.searchParams.get("token"), query: Object.fromEntries(url.searchParams), contentType: req.headers["content-type"] || "", raw });
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(data === undefined ? "" : JSON.stringify(data));
      };
      if (url.pathname === "/notes" && req.method === "POST") {
        if (failNotes) return send(500, { error: "mock note failure" });
        noteCounter += 1;
        return send(200, { id: `note_${noteCounter}`, ...JSON.parse(raw) });
      }
      if (url.pathname === "/resources" && req.method === "POST") {
        resourceCounter += 1;
        return send(200, { id: `res_${resourceCounter}` });
      }
      if (/^\/(notes|resources)\/[^/]+$/.test(url.pathname) && req.method === "DELETE") {
        return send(200);
      }
      if (url.pathname === "/search" && req.method === "GET") {
        return send(200, {
          items: [{ id: "note_1", title: "Hello", parent_id: "nb_1", updated_time: Date.now() }],
          has_more: false,
        });
      }
      send(404, { error: "not found" });
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

test("redactUrl scrubs query tokens", () => {
  assert.equal(redactUrl("failed http://x/notes?token=abc123&limit=1"), "failed http://x/notes?token=***&limit=1");
});

test("createClient requires configuration", () => {
  assert.throws(() => createClient({}), /not configured/);
});

test("createNote posts title, body and notebook with query token", async () => {
  const mock = await startMock();
  try {
    const client = createClient({ apiUrl: mock.url, token: "test-token", notebookId: "nb_1" });
    const note = await client.createNote({ title: "Hello", body: "# content" });
    assert.equal(note.id, "note_1");
    const req = mock.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.route, "/notes");
    assert.equal(req.token, "test-token");
    const payload = JSON.parse(req.raw);
    assert.equal(payload.title, "Hello");
    assert.equal(payload.body, "# content");
    assert.equal(payload.parent_id, "nb_1");
  } finally {
    await mock.close();
  }
});

test("saveToJoplin uploads resources, links them, and appends source", async () => {
  const mock = await startMock();
  try {
    const result = await saveToJoplin(
      { title: "Article", markdown: "body text", sourceUrl: "https://example.com/a", files: [PNG_PATH] },
      { apiUrl: mock.url, token: "test-token", notebookId: "nb_1" },
      { inboxDir: INBOX }
    );
    assert.equal(result.ok, true);
    assert.equal(result.noteId, "note_1");
    assert.deepEqual(result.resourceIds, ["res_1"]);
    const resourceReq = mock.requests.find((r) => r.route === "/resources");
    assert.match(resourceReq.contentType, /multipart\/form-data/);
    assert.ok(resourceReq.raw.includes("props"));
    assert.ok(resourceReq.raw.includes('name="data"'));
    assert.ok(resourceReq.raw.includes("pixel.png"));
    const noteReq = mock.requests.find((r) => r.route === "/notes");
    const payload = JSON.parse(noteReq.raw);
    assert.ok(payload.body.includes("![pixel.png](:/res_1)"));
    assert.ok(payload.body.includes("Source: https://example.com/a"));
    assert.equal(fs.existsSync(INBOX), false);
  } finally {
    await mock.close();
  }
});

test("Joplin failure falls back to inbox with redacted error", async () => {
  const result = await saveToJoplin(
    { title: "Offline Article", markdown: "saved locally", sourceUrl: "https://example.com/b" },
    { apiUrl: "http://127.0.0.1:1", token: "super-secret-token", notebookId: "nb_1", timeoutMs: 1000 },
    { inboxDir: INBOX }
  );
  assert.equal(result.ok, false);
  assert.equal(result.fallback, "inbox");
  assert.ok(fs.existsSync(result.inboxPath));
  const content = fs.readFileSync(result.inboxPath, "utf8");
  assert.ok(content.includes("Offline Article"));
  assert.ok(content.includes("saved locally"));
  assert.ok(content.includes("fallback_reason:"));
  assert.ok(!content.includes("super-secret-token"));
  assert.ok(!result.error.includes("super-secret-token"));
});

test("orphaned resources are cleaned up when note creation fails", async () => {
  const mock = await startMock({ failNotes: true });
  try {
    const result = await saveToJoplin(
      { title: "Doomed", markdown: "x", files: [PNG_PATH] },
      { apiUrl: mock.url, token: "test-token", notebookId: "nb_1" },
      { inboxDir: INBOX }
    );
    assert.equal(result.ok, false);
    assert.equal(result.fallback, "inbox");
    const deletes = mock.requests.filter((r) => r.method === "DELETE" && r.route === "/resources/res_1");
    assert.equal(deletes.length, 1);
  } finally {
    await mock.close();
  }
});

test("searchNotes queries /search with note type and clamped limit", async () => {
  const mock = await startMock();
  try {
    const client = createClient({ apiUrl: mock.url, token: "test-token", notebookId: "nb_1" });
    const result = await client.searchNotes("hello world", { limit: 500 });
    assert.equal(result.items[0].id, "note_1");
    const req = mock.requests.find((r) => r.route === "/search");
    assert.ok(req, "search request sent");
    assert.equal(req.token, "test-token");
    assert.equal(req.query.query, "hello world");
    assert.equal(req.query.type, "note");
    assert.equal(req.query.limit, "100");
  } finally {
    await mock.close();
  }
});

test("real Joplin: create note with resource, verify, delete (local only)", async (t) => {
  const honokaDir = process.env.HONOKA_DIR || path.join(os.homedir(), "honoka-docs");
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(path.join(honokaDir, ".honoka", "bridge-settings.json"), "utf8"));
  } catch { /* no local settings */ }
  if (!settings.joplinApiUrl || !settings.joplinToken) {
    return t.skip("no local Joplin settings (expected in CI)");
  }
  const client = createClient({
    apiUrl: settings.joplinApiUrl,
    token: settings.joplinToken,
    notebookId: settings.joplinNotebookId,
  });
  const stamp = new Date().toISOString();
  const result = await saveToJoplin(
    { title: `honoka-test-${stamp}`, markdown: "integration test note", sourceUrl: "https://example.com/test", files: [PNG_PATH] },
    { apiUrl: settings.joplinApiUrl, token: settings.joplinToken, notebookId: settings.joplinNotebookId },
    { inboxDir: INBOX }
  );
  assert.equal(result.ok, true, `save failed: ${result.error}`);
  try {
    const note = await client.getNote(result.noteId);
    assert.ok(note.body.includes(`(:/${result.resourceIds[0]})`));
    assert.equal(note.parent_id, settings.joplinNotebookId);
    console.log(`[integration] created note ${result.noteId} + resource ${result.resourceIds[0]} in notebook ${settings.joplinNotebookId}`);
  } finally {
    await client.deleteNote(result.noteId);
    for (const id of result.resourceIds) await client.deleteResource(id);
    console.log("[integration] cleaned up test note and resource");
  }
  await assert.rejects(() => client.getNote(result.noteId), /Joplin 404/);
});
