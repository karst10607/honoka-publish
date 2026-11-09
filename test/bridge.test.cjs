/**
 * Bridge security tests — zero runtime dependencies (node:test + node:assert).
 * Run: npm test
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-bridge-test-"));
process.env.HONOKA_DIR = TMP;

const { createServer } = require("../src/bridge");

const SETTINGS_FILE = path.join(TMP, ".honoka", "bridge-settings.json");

function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
}

function writeSettings(patch) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, method, urlPath, { token, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Connection: "close" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function withServer(fn) {
  const server = createServer();
  const port = await listen(server);
  try {
    return await fn(port, readSettings().bridgeToken);
  } finally {
    await close(server);
  }
}

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("token is auto-generated, stored 0600, and stable across servers", async () => {
  let firstToken;
  await withServer(async (_port, token) => {
    firstToken = token;
    assert.match(token, /^[0-9a-f]{48}$/);
    assert.equal(fs.statSync(SETTINGS_FILE).mode & 0o777, 0o600);
  });
  await withServer(async (_port, token) => {
    assert.equal(token, firstToken);
  });
});

test("requests without a token are rejected with 401", async () => {
  await withServer(async (port) => {
    for (const [method, route] of [["GET", "/status"], ["GET", "/api/docs"], ["GET", "/api/settings"], ["POST", "/api/save"]]) {
      const res = await request(port, method, route, method === "POST" ? { body: {} } : {});
      assert.equal(res.status, 401, `${method} ${route}`);
    }
  });
});

test("wrong tokens are rejected (header and query)", async () => {
  await withServer(async (port) => {
    const header = await request(port, "GET", "/status", { token: "wrong-token" });
    assert.equal(header.status, 401);
    const query = await request(port, "GET", "/status?token=wrong-token");
    assert.equal(query.status, 401);
  });
});

test("valid bearer or query token grants access", async () => {
  await withServer(async (port, token) => {
    const header = await request(port, "GET", "/status", { token });
    assert.equal(header.status, 200);
    assert.equal(JSON.parse(header.text).ok, true);
    const query = await request(port, "GET", `/status?token=${token}`);
    assert.equal(query.status, 200);
  });
});

test("authenticated save and docs round-trip", async () => {
  await withServer(async (port, token) => {
    const save = await request(port, "POST", "/api/save", {
      token,
      body: { title: "Test Clip", markdown: "# hello", url: "https://example.com" },
    });
    assert.equal(save.status, 200);
    const saved = JSON.parse(save.text);
    assert.equal(saved.ok, true);
    assert.ok(fs.existsSync(saved.path));
    const docs = await request(port, "GET", "/api/docs", { token });
    assert.equal(docs.status, 200);
    const list = JSON.parse(docs.text);
    assert.ok(list.docs.some((d) => d.path.includes("test-clip")));
  });
});

test("settings GET never returns plaintext secrets", async () => {
  const secrets = {
    notionPat: "secret_notion_pat_123456",
    telegramBotToken: "123456:ABCDEF_telegram_secret",
    anytypeApiKey: "anytype_secret_key_999",
    discordBotToken: "discord_secret_token_888",
  };
  writeSettings(secrets);
  await withServer(async (port, token) => {
    const res = await request(port, "GET", "/api/settings", { token });
    assert.equal(res.status, 200);
    for (const value of Object.values(secrets)) {
      assert.ok(!res.text.includes(value), `leaked: ${value}`);
    }
    assert.ok(!res.text.includes(token), "bridge token leaked");
    const settings = JSON.parse(res.text).settings;
    assert.equal(settings.notionPat, "••••3456");
    assert.equal(settings.telegramBotToken, "••••cret");
    assert.equal(settings.bridgeToken, "••••" + token.slice(-4));
  });
});

test("settings POST cannot overwrite the bridge token and validates origins", async () => {
  await withServer(async (port, token) => {
    const before = readSettings().bridgeToken;
    const overwrite = await request(port, "POST", "/api/settings", { token, body: { bridgeToken: "evil" } });
    assert.equal(overwrite.status, 200);
    assert.equal(readSettings().bridgeToken, before);
    const invalid = await request(port, "POST", "/api/settings", { token, body: { bridgeAllowedOrigins: "not-an-array" } });
    assert.equal(invalid.status, 400);
  });
});

test("CORS is restricted to configured origins; preflight needs no auth", async () => {
  await withServer(async (port, token) => {
    const denied = await request(port, "GET", "/status", { token, origin: "https://evil.example" });
    assert.equal(denied.headers["access-control-allow-origin"], undefined);

    writeSettings({ bridgeAllowedOrigins: ["chrome-extension://allowed"] });
    const allowed = await request(port, "GET", "/status", { token, origin: "chrome-extension://allowed" });
    assert.equal(allowed.headers["access-control-allow-origin"], "chrome-extension://allowed");
    const stillDenied = await request(port, "GET", "/status", { token, origin: "https://evil.example" });
    assert.equal(stillDenied.headers["access-control-allow-origin"], undefined);

    const preflightOk = await request(port, "OPTIONS", "/api/save", { origin: "chrome-extension://allowed" });
    assert.equal(preflightOk.status, 204);
    assert.match(preflightOk.headers["access-control-allow-headers"], /Authorization/);
    const preflightDenied = await request(port, "OPTIONS", "/api/save", { origin: "https://evil.example" });
    assert.equal(preflightDenied.status, 403);
  });
});
