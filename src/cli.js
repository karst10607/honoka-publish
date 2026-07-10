/**
 * CLI argument parser and orchestrator.
 * No external dependencies — vanilla Node.js argument parsing.
 */
const fs = require("fs");
const path = require("path");
const { syncDirectory } = require("./sync");
const { startWatcher } = require("./watcher");
const { initConfig } = require("./registry");
const { getLicenseLevel } = require("./license");
const { runBridge } = require("./bridge");
const { runMCP } = require("./mcp");

const HELP_TEXT = `
honoka-publish — Publish local Markdown files to Notion.

USAGE
  honoka-publish                          Start MCP server (for AI tools)
  honoka-publish bridge [--port <n>]      Start Bridge HTTP server (for Chrome Extension)
  honoka-publish <directory>              One-shot sync
  honoka-publish --watch <directory>      Watch for changes
  honoka-publish --init                   Create .honoka config in CWD
  honoka-publish --version                Show version
  honoka-publish --help                   Show this message

MODES
  MCP mode (default)       Communicates over stdio via MCP protocol
                           Integrates with Qoder, Claude Code, Cursor
  Bridge mode (HTTP)       Starts HTTP server on port 44124
                           Chrome Extension connects here
  Sync mode                Reads .md files and pushes to Notion

OPTIONS
  --notion-token <pat>    Notion PAT (or set NOTION_TOKEN env)
  --notion-database <id>  Database ID (or set NOTION_DATABASE env)
  --watch                 Watch directory for changes
  --pro                   Enable Pro features (multi-dir, multi-target)
  --verbose               Show detailed logs
  --port <n>              Bridge server port (default: 44124)

EXAMPLES
  honoka-publish                        # AI tool integration (MCP)
  honoka-publish bridge                 # Chrome Extension HTTP server
  honoka-publish bridge --port 44125    # Custom port
  honoka-publish ./docs                 # Sync to Notion
  honoka-publish --watch ./docs
  honoka-publish --init

ENVIRONMENT
  NOTION_TOKEN            Notion Personal Access Token
  NOTION_DATABASE         Notion Database ID
  HONOKA_DIR              Docs directory (default: ~/honoka-docs)
  HONOKA_LICENSE          Pro license key
`;

function parseArgs(args) {
  const opts = {
    directory: null,
    watch: false,
    init: false,
    verbose: false,
    pro: false,
    notionToken: null,
    notionDatabase: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        console.log(HELP_TEXT);
        process.exit(0);
      case "--version":
      case "-v": {
        const pkg = require("../package.json");
        console.log(pkg.version);
        process.exit(0);
      }
      case "--watch":
        opts.watch = true;
        break;
      case "--init":
        opts.init = true;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      case "--pro":
        opts.pro = true;
        break;
      case "--port":
        opts.port = parseInt(args[++i], 10) || 44124;
        break;
      case "--notion-token":
        opts.notionToken = args[++i];
        break;
      case "--notion-database":
        opts.notionDatabase = args[++i];
        break;
      case "bridge":
        opts.mode = "bridge";
        break;
      default:
        if (!arg.startsWith("--") && !opts.directory && !opts.mode) {
          opts.directory = arg;
        }
        break;
    }
  }

  // Env fallback
  if (!opts.notionToken) opts.notionToken = process.env.NOTION_TOKEN || null;
  if (!opts.notionDatabase) opts.notionDatabase = process.env.NOTION_DATABASE || null;

  return opts;
}

async function run(rawArgs) {
  const opts = parseArgs(rawArgs);

  // ── Bridge mode ──
  if (opts.mode === "bridge") {
    runBridge(opts.port || 44124);
    return; // runBridge blocks via server.listen
  }

  if (opts.init) {
    return initConfig(process.cwd());
  }

  // ── Default (no args) → MCP mode ──
  if (!opts.directory && !opts.watch) {
    runMCP();
    return; // runMCP blocks on stdin
  }

  const targetDir = opts.directory || process.cwd();
  const resolved = path.resolve(targetDir);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  // License check
  const license = getLicenseLevel({ explicitPro: opts.pro });
  if (opts.pro && license !== "pro") {
    throw new Error(
      "Pro mode requires a valid license key. Set HONOKA_LICENSE env or add .honoka-license file."
    );
  }

  const syncOpts = {
    notionToken: opts.notionToken,
    notionDatabase: opts.notionDatabase,
    verbose: opts.verbose,
    license,
  };

  if (!syncOpts.notionToken) {
    console.warn("⚠  NOTION_TOKEN not set. Set it via --notion-token or NOTION_TOKEN env.");
    console.warn("   Some features will be unavailable.");
  }

  if (!syncOpts.notionDatabase) {
    console.warn("⚠  NOTION_DATABASE not set. Set it via --notion-database or NOTION_DATABASE env.");
  }

  if (opts.watch) {
    console.log(`👀 Watching: ${resolved}`);
    await startWatcher(resolved, syncOpts);
  } else {
    const result = await syncDirectory(resolved, syncOpts);
    console.log(`\nDone. ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors.`);
  }
}

module.exports = { run, parseArgs };
