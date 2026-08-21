#!/usr/bin/env node
"use strict";
/**
 * Path B: drive honoka-publish's MCP server over stdio (JSON-RPC), calling
 * save-clip once per generated doc. Measures wall time, per-doc latency,
 * and success/failure per call.
 *
 * Usage: node paths/mcp-path.cjs --round 1
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BENCH = path.join(ROOT, "benchmarks", "mcp-vs-cli");
const DOCS = path.join(BENCH, "work", "docs");
const RAW = path.join(BENCH, "results", "raw");

const args = process.argv.slice(2);
const round = args[args.indexOf("--round") + 1] ?? "1";
fs.mkdirSync(RAW, { recursive: true });

const docs = fs.readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();
const mcp = spawn(process.execPath, ["-e", "require('./src/mcp').runMCP()"], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const pending = new Map();
const transcript = [];
const perDoc = [];

function send(obj) {
  mcp.stdin.write(JSON.stringify(obj) + "\n");
}

function waitFor(id, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout id=${id}`));
    }, timeoutMs);
    pending.set(id, { resolve, timer });
  });
}

// Minimal frontmatter parse: title / category / source, body = rest of file
function parseDoc(content) {
  const fm = { title: null, category: null, source: null };
  let body = content;
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    body = content.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*["']?([^"']*?)["']?\s*$/);
      if (kv && kv[1] in fm) fm[kv[1]] = kv[2];
    }
  }
  return { fm, body };
}

mcp.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    transcript.push(line);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (!msg.id || !pending.has(msg.id)) continue;
    const p = pending.get(msg.id);
    clearTimeout(p.timer);
    pending.delete(msg.id);
    p.resolve(msg);
  }
});

(async () => {
  const t0 = performance.now();
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await waitFor(1);

  let ok = 0;
  let fail = 0;
  const failures = [];

  for (let i = 0; i < docs.length; i++) {
    const file = docs[i];
    const content = fs.readFileSync(path.join(DOCS, file), "utf8");
    const { fm, body } = parseDoc(content);
    const id = 1000 + i;
    const t1 = performance.now();
    send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "save-clip",
        arguments: {
          title: fm.title || file,
          markdown: body,
          category: fm.category || "benchmark",
          source: fm.source || "benchmark",
        },
      },
    });
    try {
      const res = await waitFor(id);
      const latency = Math.round(performance.now() - t1);
      const isErr = !!res.error || res.result?.isError;
      if (isErr) {
        fail++;
        failures.push({
          file,
          latency,
          error: (res.error || res.result?.content?.[0]?.text || "error").toString().slice(0, 200),
        });
      } else {
        ok++;
      }
      perDoc.push({ file, latency, ok: !isErr });
    } catch (e) {
      fail++;
      failures.push({ file, error: e.message });
    }
  }

  const wallMs = Math.round(performance.now() - t0);
  const result = {
    round: Number(round),
    path: "mcp",
    wallMs,
    docs: docs.length,
    ok,
    fail,
    failures: failures.slice(0, 10),
    perDocMs: perDoc.map((r) => r.latency),
  };
  fs.writeFileSync(path.join(RAW, `round-${round}-mcp.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(RAW, `round-${round}-mcp.log`), transcript.join("\n"));
  console.log(`[mcp] round ${round}: wall=${wallMs}ms ok=${ok}/${docs.length} fail=${fail}`);
  mcp.kill();
  process.exit(0);
})();
