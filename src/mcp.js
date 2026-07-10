/**
 * Lightweight MCP (Model Context Protocol) stdio server.
 *
 * Implements the MCP stdio transport for AI tool integration.
 * Communicates via JSON-RPC over stdin/stdout.
 *
 * Supported tools:
 *   - save-clip         Save a clipped page to local disk
 *   - push-to-notion    Push markdown content to Notion
 *   - sync-directory    Sync a local directory to Notion
 *   - list-docs         List locally saved documents
 */
const fs = require("fs");
const path = require("path");

const { createPage, appendBlocks } = require("./notion");
const { toBlocks, parseFrontmatter } = require("./markdown");
const { syncDirectory } = require("./sync");

const PKG = require("../package.json");
const VERSION = PKG.version;

// ── Protocol Constants ──

const PROTOCOL_VERSION = "2024-11-05";

// ── JSON-RPC over stdio ──

let messageBuffer = "";

function startStdioServer() {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    messageBuffer += chunk;
    processMessages();
  });
  process.stdin.on("error", (err) => {
    console.error("[MCP] stdin error:", err.message);
  });
}

function processMessages() {
  const parts = messageBuffer.split("\n");
  // Keep the last partial line in buffer
  messageBuffer = parts.pop() || "";

  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg).catch((err) => {
        sendError(msg.id, -32603, err.message);
      });
    } catch (err) {
      // Not JSON — ignore (keep-alive or noise)
    }
  }
}

function sendMessage(msg) {
  const str = JSON.stringify(msg) + "\n";
  process.stdout.write(str);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── Request Handlers ──

async function handleMessage(msg) {
  if (msg.jsonrpc !== "2.0" || !msg.method) return;

  const { id, method, params } = msg;

  switch (method) {
    // ── Lifecycle ──
    case "initialize":
      return handleInitialize(id, params);
    case "notifications/initialized":
      return; // ACK, no response needed

    // ── Tools ──
    case "tools/list":
      return handleToolsList(id);
    case "tools/call":
      return handleToolsCall(id, params);

    // ── Resources (optional) ──
    case "resources/list":
      return sendResult(id, { resources: [] });

    default:
      // Unknown method — ignore gracefully
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

function handleInitialize(id, params) {
  sendResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
      resources: {},
    },
    serverInfo: {
      name: "honoka-publish",
      version: VERSION,
    },
  });
}

function handleToolsList(id) {
  sendResult(id, {
    tools: [
      {
        name: "save-clip",
        description: "Save a clipped web page or markdown content to the local disk.",
        inputSchema: {
          type: "object",
          required: ["title", "markdown"],
          properties: {
            title: { type: "string", description: "Title of the clip" },
            markdown: { type: "string", description: "Markdown content" },
            url: { type: "string", description: "Original URL (optional)" },
            source: { type: "string", description: "Source identifier (default: mcp)", default: "mcp" },
            category: { type: "string", description: "Category folder (default: reference)", default: "reference" },
          },
        },
      },
      {
        name: "push-to-notion",
        description: "Push markdown content directly to a Notion database page.",
        inputSchema: {
          type: "object",
          required: ["title", "markdown"],
          properties: {
            title: { type: "string", description: "Page title" },
            markdown: { type: "string", description: "Markdown content" },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env)" },
          },
        },
      },
      {
        name: "sync-directory",
        description: "Sync a local directory of markdown files to Notion incrementally.",
        inputSchema: {
          type: "object",
          required: ["directory"],
          properties: {
            directory: { type: "string", description: "Absolute path to directory" },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env)" },
          },
        },
      },
      {
        name: "list-docs",
        description: "List locally saved documents in the clips directory.",
        inputSchema: {
          type: "object",
          properties: {
            directory: { type: "string", description: "Clips directory path (default: HONOKA_DIR or ~/honoka-docs/Clips)" },
          },
        },
      },
    ],
  });
}

async function handleToolsCall(id, params) {
  const { name, arguments: args } = params;

  switch (name) {
    case "save-clip":
      return handleSaveClip(id, args);
    case "push-to-notion":
      return handlePushToNotion(id, args);
    case "sync-directory":
      return handleSyncDirectory(id, args);
    case "list-docs":
      return handleListDocs(id, args);
    default:
      sendError(id, -32601, `Tool not found: ${name}`);
  }
}

// ── Tool Implementations ──

const HONOKA_DIR = process.env.HONOKA_DIR || path.join(require("os").homedir(), "honoka-docs");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

async function handleSaveClip(id, args) {
  const { title, markdown, url, source, category } = args;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "/");
  const slug = slugify(title) || "untitled";
  const folder = path.join(HONOKA_DIR, "Clips", category || "reference", `${dateStr}-${slug}`);
  ensureDir(folder);

  const filePath = path.join(folder, "index.md");
  const frontmatter = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${now.toISOString()}`,
    url ? `source: ${url}` : null,
    `category: ${category || "reference"}`,
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  fs.writeFileSync(filePath, frontmatter + markdown, "utf8");

  sendResult(id, {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: true,
          path: filePath,
          title,
          slug,
        }),
      },
    ],
  });
}

async function handlePushToNotion(id, args) {
  const { title, markdown, notionToken, notionDatabase } = args;
  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;

  if (!token) {
    return sendError(id, -32000, "Notion token not provided. Set NOTION_TOKEN env or pass notionToken.");
  }
  if (!databaseId) {
    return sendError(id, -32000, "Notion database ID not provided. Set NOTION_DATABASE env or pass notionDatabase.");
  }

  try {
    // Create page
    const page = await createPage(token, databaseId, { title });
    const pageId = page.id;

    // Convert and append blocks
    const blocks = toBlocks(markdown);
    await appendBlocks(token, pageId, blocks);

    sendResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            pageId,
            title,
            blockCount: blocks.length,
            notionUrl: `https://notion.so/${pageId.replace(/-/g, "")}`,
          }),
        },
      ],
    });
  } catch (err) {
    sendError(id, -32000, `Notion push failed: ${err.message}`);
  }
}

async function handleSyncDirectory(id, args) {
  const { directory, notionToken, notionDatabase } = args;
  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;

  if (!token) {
    return sendError(id, -32000, "Notion token not provided.");
  }
  if (!databaseId) {
    return sendError(id, -32000, "Notion database ID not provided.");
  }

  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    return sendError(id, -32000, `Directory not found: ${resolved}`);
  }

  try {
    const result = await syncDirectory(resolved, {
      notionToken: token,
      notionDatabase: databaseId,
      verbose: false,
    });

    sendResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            directory: resolved,
            synced: result.synced,
            skipped: result.skipped,
            errors: result.errors,
          }),
        },
      ],
    });
  } catch (err) {
    sendError(id, -32000, `Sync failed: ${err.message}`);
  }
}

async function handleListDocs(id, args) {
  const clipsDir = args.directory || path.join(HONOKA_DIR, "Clips");

  if (!fs.existsSync(clipsDir)) {
    return sendResult(id, {
      content: [{ type: "text", text: JSON.stringify({ ok: true, docs: [], dir: clipsDir }) }],
    });
  }

  const docs = [];
  function walk(dir, depth = 0) {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name === "index.md") {
        const rel = path.relative(clipsDir, full);
        const stat = fs.statSync(full);
        docs.push({ path: rel, size: stat.size, modified: stat.mtime.toISOString() });
      }
    }
  }
  walk(clipsDir);

  docs.sort((a, b) => b.modified.localeCompare(a.modified));
  const total = docs.length;
  const recent = docs.slice(0, 20);

  sendResult(id, {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, total, docs: recent, dir: clipsDir }),
      },
    ],
  });
}

// ── Entry ──

function runMCP() {
  // MCP uses stderr for logging, stdout for protocol
  console.error("[honoka-publish] MCP server starting, protocol version:", PROTOCOL_VERSION);
  startStdioServer();
}

module.exports = { runMCP };
