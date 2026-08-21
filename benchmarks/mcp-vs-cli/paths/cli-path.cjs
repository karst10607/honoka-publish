#!/usr/bin/env node
"use strict";
/**
 * Path A: honoka-publish CLI — one-shot sync of the generated corpus.
 * Measures wall time, per-doc success/skip/error counts (parsed from the
 * CLI's summary line), and exit code; captures stdout/stderr for the transcript.
 *
 * Usage: node paths/cli-path.cjs --round 1
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

const t0 = performance.now();
const child = spawn(process.execPath, [path.join(ROOT, "bin", "honoka-publish.js"), DOCS], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

child.on("close", (code) => {
  const wallMs = Math.round(performance.now() - t0);
  // "Done. N synced, M skipped, K errors." (src/cli.js) — synced+skipped are
  // docs that ended up in sync; errors are docs the Notion API rejected.
  const m = out.match(/Done\.\s*(\d+)\s+synced,\s*(\d+)\s+skipped,\s*(\d+)\s+errors\./);
  const synced = m ? Number(m[1]) : 0;
  const skipped = m ? Number(m[2]) : 0;
  const errors = m ? Number(m[3]) : 0;
  const result = {
    round: Number(round),
    path: "cli",
    wallMs,
    exitCode: code,
    ok: synced + skipped,
    fail: errors,
    skipped,
    docs: synced + skipped + errors,
    summaryParsed: !!m,
    stdoutTail: out.slice(-2000),
    stderrTail: err.slice(-2000),
  };
  fs.writeFileSync(path.join(RAW, `round-${round}-cli.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(
    path.join(RAW, `round-${round}-cli.log`),
    `exit=${code} wall=${wallMs}ms\n--- stdout ---\n${out}\n--- stderr ---\n${err}`
  );
  console.log(`[cli] round ${round}: exit=${code} wall=${wallMs}ms`);
});
