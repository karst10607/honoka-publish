#!/usr/bin/env node
/**
 * honoka-publish — CLI entry point.
 * Usage:
 *   honoka-publish <directory>          One-shot sync
 *   honoka-publish --watch <directory>  Watch mode
 *   honoka-publish --init               Create .honoka config
 *   honoka-publish --help               Show help
 */
const { run } = require("../src/cli");
run(process.argv.slice(2)).catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
