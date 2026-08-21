#!/usr/bin/env node
"use strict";
/**
 * Generates the benchmark corpus: N Markdown docs with frontmatter, headings,
 * lists, code blocks, links). Images are opt-in (--images).
 * The corpus is regenerated fresh on every run (rm + mkdir).
 *
 * Usage: node gen-docs.cjs --count 50 --out work/docs [--images]
 * Images are opt-in: the corpus defaults to no images because honoka-publish's
 * markdown path emits relative asset URLs (assets/img.png) which the Notion
 * API rejects with HTTP 400 (see README Limitations).
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const idx = (k) => args.indexOf(k);
const count = Number(idx("--count") >= 0 ? args[idx("--count") + 1] : 50);
const out = path.resolve(idx("--out") >= 0 ? args[idx("--out") + 1] : path.join(__dirname, "work", "docs"));
const withImages = args.includes("--images");

// 1x1 transparent PNG — tiny, valid, reproducible image workload
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function frontmatter(i) {
  const n = String(i).padStart(3, "0");
  return [
    "---",
    `title: "Benchmark Doc ${n}"`,
    "date: 2026-08-21",
    'tags: ["benchmark", "mcp-vs-cli"]',
    'category: "benchmark"',
    'source: "gen-docs"',
    `slug: "bench-doc-${n}"`,
    "---",
  ].join("\n");
}

function body(i, withImages) {
  const n = String(i).padStart(3, "0");
  const lines = [];
  lines.push(`# Benchmark Doc ${n}`);
  lines.push("");
  lines.push(`Paragraph ${i}: measures **publishing** behavior — bold, *italic*, \`inline code\`, and a [link](https://example.com/bench-${i}).`);
  lines.push("");
  lines.push("## Section A");
  lines.push("");
  lines.push("- item one");
  lines.push("- item two");
  lines.push("- item three");
  lines.push("");
  // "javascript" — Notion API rejects "js" as a code language (400 body validation)
  lines.push("```javascript");
  lines.push(`const id = ${i};`);
  lines.push("const ok = id > 0;");
  lines.push("```");
  lines.push("");
  if (withImages) {
    lines.push(`![img_${i}](assets/img_${i}.png)`);
    lines.push("");
  }
  lines.push("## Section B");
  lines.push("");
  lines.push("> A quote line for variety.");
  lines.push("");
  lines.push("1. first");
  lines.push("2. second");
  return lines.join("\n");
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets"), { recursive: true });

for (let i = 1; i <= count; i++) {
  const n = String(i).padStart(3, "0");
  const md = [frontmatter(i), "", body(i, withImages), ""].join("\n");
  fs.writeFileSync(path.join(out, `doc-${n}.md`), md);
  if (withImages) {
    fs.writeFileSync(path.join(out, "assets", `img_${i}.png`), PNG_1PX);
  }
}

console.log(`generated ${count} docs in ${out}${withImages ? " (with images)" : ""}`);
