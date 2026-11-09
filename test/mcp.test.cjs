/**
 * MCP stdio smoke test — spawns the real server (bin/honoka-publish.js),
 * exercises initialize → tools/list → save_url ticket → get_job_status →
 * list_inbox over JSON-RPC. Joplin is unconfigured, so ingestion lands in the
 * inbox; capture is disabled to keep the test browser-free.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-mcp-test-"));
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, "bin", "honoka-publish.js")], {
    cwd: ROOT,
    env: { ...process.env, HONOKA_DIR: TMP, HONOKA_DISABLE_CAPTURE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const waiters = new Map();
  const stderr = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const waiter = waiters.get(message.id);
      if (waiter) {
        waiters.delete(message.id);
        waiter(message);
      }
    }
  });
  let seq = 0;
  function rpc(method, params, timeoutMs = 10000) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error(`timeout waiting for ${method}; stderr: ${stderr.join("").slice(-500)}`));
      }, timeoutMs);
      waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  return { rpc, stop: () => child.kill(), stderr };
}

function toolPayload(response) {
  assert.ok(response.result, `expected result, got: ${JSON.stringify(response.error)}`);
  assert.equal(response.result.content[0].type, "text");
  return JSON.parse(response.result.content[0].text);
}

function startArticleServer() {
  const html = `<!DOCTYPE html><html><head><title>MCP Smoke Article</title>
<meta name="description" content="article for the mcp smoke test"></head><body>
<article><h1>MCP Smoke Article</h1>
<p>This paragraph exists so the readability parser scores the article container as the main content of the page, with commas, clauses, and enough words.</p>
<p>A second paragraph adds more body text, another clause, and a topliner phrase for the note body to verify extraction output.</p>
</article></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}/article`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function pollJob(rpc, ticketId, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    const job = toolPayload(await rpc("tools/call", { name: "get_job_status", arguments: { ticketId } }));
    if (job.status !== "running") return job;
    if (Date.now() - started > timeoutMs) throw new Error(`job ${ticketId} still running after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("MCP smoke: tools/list, save_url ticket, get_job_status, list_inbox", { timeout: 30000 }, async () => {
  const article = await startArticleServer();
  const server = startServer();
  try {
    const init = await server.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });
    assert.equal(init.result.serverInfo.name, "honoka-publish");

    const list = await server.rpc("tools/list", {});
    const names = list.result.tools.map((tool) => tool.name);
    for (const expected of ["save_url", "download_video", "search_notes", "list_inbox", "get_job_status"]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }

    const ticket = toolPayload(await server.rpc("tools/call", {
      name: "save_url",
      arguments: { url: article.base },
    }));
    assert.match(ticket.ticketId, /^job_/);
    assert.equal(ticket.status, "running");

    const job = await pollJob(server.rpc, ticket.ticketId);
    assert.equal(job.status, "done");
    assert.equal(job.result.ok, false);
    assert.equal(job.result.fallback, "inbox");
    assert.ok(fs.existsSync(job.result.inboxPath), `inbox file missing: ${job.result.inboxPath}`);

    const inbox = toolPayload(await server.rpc("tools/call", { name: "list_inbox", arguments: {} }));
    assert.ok(inbox.count >= 1);
    assert.equal(inbox.items[0].title, "MCP Smoke Article");

    const unknown = await server.rpc("tools/call", { name: "get_job_status", arguments: { ticketId: "job_nope" } });
    assert.equal(unknown.error.code, -32000);

    const missingUrl = await server.rpc("tools/call", { name: "save_url", arguments: {} });
    assert.equal(missingUrl.error.code, -32602);
  } finally {
    server.stop();
    await article.close();
  }
});