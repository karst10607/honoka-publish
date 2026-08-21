#!/usr/bin/env node
"use strict";
/**
 * Aggregates results/raw/round-*.json into results/summary.csv and prints it.
 * Columns: round, path, wallMs, ok, fail, skipped
 */
const fs = require("fs");
const path = require("path");

const RAW = path.join(__dirname, "results", "raw");
const files = fs.readdirSync(RAW).filter((f) => f.endsWith(".json")).sort();

const rows = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8"));
  const ok = j.ok ?? (j.path === "cli" ? (j.exitCode === 0 ? 1 : 0) : 0);
  rows.push({
    round: j.round,
    path: j.path,
    wallMs: j.wallMs,
    ok,
    fail: j.fail ?? 0,
    skipped: j.skipped ?? 0,
  });
}
rows.sort((a, b) => a.round - b.round || a.path.localeCompare(b.path));

const csv = [
  "round,path,wallMs,ok,fail,skipped",
  ...rows.map((r) => `${r.round},${r.path},${r.wallMs},${r.ok},${r.fail},${r.skipped}`),
].join("\n");

fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "results", "summary.csv"), csv + "\n");
console.log(csv);
