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

const { createPage, updatePageProperties, appendBlocks, clearPage, queryDatabase } = require("./notion");
const { toBlocks, parseFrontmatter } = require("./markdown");
const { syncDirectory } = require("./sync");
const {
  saveToAnytype: anytypeCreate,
  updateAnytype,
  getAnytypeObject,
  searchAnytype,
  deleteAnytypeObject,
} = require("./integrations/anytype");

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
      // ── Read ──
      {
        name: "read-clip",
        description: "Read a locally saved clip by slug or relative path. Returns markdown content.",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", description: "Document slug (folder name) or relative path from Clips dir, e.g. '2026/04/my-doc'" },
            directory: { type: "string", description: "Clips directory path (default: HONOKA_DIR/Clips)" },
          },
        },
      },
      {
        name: "read_doc",
        description: "Alias for read-clip. Read a locally saved document by slug. Returns markdown content + images list.",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", description: "Document slug (folder name)" },
            directory: { type: "string", description: "Clips directory path (default: HONOKA_DIR/Clips)" },
          },
        },
      },
      // ── Save ──
      {
        name: "save-clip",
        description: "Save markdown content to local disk. Optionally attach base64-encoded images.",
        inputSchema: {
          type: "object",
          required: ["title", "markdown"],
          properties: {
            title: { type: "string", description: "Title of the clip" },
            markdown: { type: "string", description: "Markdown content" },
            url: { type: "string", description: "Original source URL (optional)" },
            source: { type: "string", description: "Source identifier (default: mcp)", default: "mcp" },
            category: { type: "string", description: "Category folder (default: reference)", default: "reference" },
            images: {
              type: "array",
              description: "Optional images to save alongside the clip",
              items: {
                type: "object",
                properties: {
                  filename: { type: "string", description: "Image filename (e.g. 'screenshot.png')" },
                  dataUrl: { type: "string", description: "Base64 data URL (data:image/...;base64,...)" },
                },
              },
            },
          },
        },
      },
      {
        name: "save-and-push",
        description: "Save markdown to local disk AND push to Notion in one call. Uses registry to UPDATE existing pages.",
        inputSchema: {
          type: "object",
          required: ["title", "markdown"],
          properties: {
            title: { type: "string", description: "Page title" },
            markdown: { type: "string", description: "Markdown content" },
            url: { type: "string", description: "Original source URL (optional)" },
            source: { type: "string", description: "Source identifier (default: mcp)", default: "mcp" },
            category: { type: "string", description: "Category folder (default: reference)", default: "reference" },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env)" },
            images: {
              type: "array",
              description: "Optional images (base64 dataUrl)",
              items: {
                type: "object",
                properties: {
                  filename: { type: "string" },
                  dataUrl: { type: "string" },
                },
              },
            },
          },
        },
      },
      {
        name: "save_and_sync",
        description: "Alias for save-and-push. Save markdown to local disk AND push to Notion in one call.",
        inputSchema: {
          type: "object",
          required: ["title", "markdown"],
          properties: {
            title: { type: "string", description: "Page title" },
            markdown: { type: "string", description: "Markdown content" },
            url: { type: "string", description: "Original source URL (optional)" },
            source: { type: "string", description: "Source identifier (default: mcp)", default: "mcp" },
            category: { type: "string", description: "Category folder (default: reference)", default: "reference" },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env)" },
            images: {
              type: "array",
              description: "Optional images (base64 dataUrl)",
              items: {
                type: "object",
                properties: {
                  filename: { type: "string" },
                  dataUrl: { type: "string" },
                },
              },
            },
          },
        },
      },
      {
        name: "sync-clip",
        description: "Push an already-saved local clip to Notion by slug. Uses registry for CREATE vs UPDATE tracking.",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", description: "Document slug (folder name)" },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env)" },
          },
        },
      },
      // ── Notion ──
      {
        name: "query-notion",
        description: "Query a Notion database and list pages (title + URL). Optionally filter by title text.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional title text to search for (contains match)" },
            limit: { type: "number", description: "Max results", default: 20 },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env)" },
          },
        },
      },
      {
        name: "push-to-notion",
        description: "Push markdown to Notion. Provide pageId to update an existing page, or omit to create new.",
        inputSchema: {
          type: "object",
          required: ["title", "markdown"],
          properties: {
            title: { type: "string", description: "Page title" },
            markdown: { type: "string", description: "Markdown content" },
            pageId: { type: "string", description: "Notion page ID to update (omit to create new)" },
            notionToken: { type: "string", description: "Notion PAT (or set NOTION_TOKEN env)" },
            notionDatabase: { type: "string", description: "Database ID (or set NOTION_DATABASE env, required for CREATE)" },
          },
        },
      },
      // ── Directory Sync ──
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
      // ── List ──
      {
        name: "list-docs",
        description: "List locally saved documents in the clips directory.",
        inputSchema: {
          type: "object",
          properties: {
            directory: { type: "string", description: "Clips directory path (default: HONOKA_DIR/Clips)" },
          },
        },
      },
      // ── AnyType ──
      {
        name: "sync_to_anytype",
        description: "Sync an existing local doc to AnyType by slug. Creates or updates an AnyType object.",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", description: "Document slug (folder name)" },
            anytypeApiKey: { type: "string", description: "AnyType API key (or set HONOKA_ANYTYPE_API_KEY env)" },
            anytypeSpaceId: { type: "string", description: "AnyType space ID (or set HONOKA_ANYTYPE_SPACE_ID env)" },
          },
        },
      },
      {
        name: "search_anytype",
        description: "Search AnyType objects by query string.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results", default: 20 },
            anytypeApiKey: { type: "string", description: "AnyType API key (or set HONOKA_ANYTYPE_API_KEY env)" },
            anytypeSpaceId: { type: "string", description: "AnyType space ID (or set HONOKA_ANYTYPE_SPACE_ID env)" },
          },
        },
      },
      {
        name: "read_anytype",
        description: "Read an AnyType object by its object ID.",
        inputSchema: {
          type: "object",
          required: ["objectId"],
          properties: {
            objectId: { type: "string", description: "AnyType object ID" },
            anytypeApiKey: { type: "string", description: "AnyType API key (or set HONOKA_ANYTYPE_API_KEY env)" },
            anytypeSpaceId: { type: "string", description: "AnyType space ID (or set HONOKA_ANYTYPE_SPACE_ID env)" },
          },
        },
      },
      {
        name: "delete_anytype",
        description: "Delete an AnyType object by its object ID.",
        inputSchema: {
          type: "object",
          required: ["objectId"],
          properties: {
            objectId: { type: "string", description: "AnyType object ID" },
            anytypeApiKey: { type: "string", description: "AnyType API key (or set HONOKA_ANYTYPE_API_KEY env)" },
            anytypeSpaceId: { type: "string", description: "AnyType space ID (or set HONOKA_ANYTYPE_SPACE_ID env)" },
          },
        },
      },
    ],
  });
}

async function handleToolsCall(id, params) {
  const { name, arguments: args } = params;

  switch (name) {
    case "read-clip":
    case "read_doc":
      return handleReadClip(id, args);
    case "save-clip":
      return handleSaveClip(id, args);
    case "save-and-push":
    case "save_and_sync":
      return handleSaveAndPush(id, args);
    case "sync-clip":
      return handleSyncClip(id, args);
    case "push-to-notion":
      return handlePushToNotion(id, args);
    case "query-notion":
      return handleQueryNotion(id, args);
    case "sync-directory":
      return handleSyncDirectory(id, args);
    case "list-docs":
      return handleListDocs(id, args);
    case "sync_to_anytype":
      return handleSyncToAnytype(id, args);
    case "search_anytype":
      return handleSearchAnytype(id, args);
    case "read_anytype":
      return handleReadAnytype(id, args);
    case "delete_anytype":
      return handleDeleteAnytype(id, args);
    default:
      sendError(id, -32601, `Tool not found: ${name}`);
  }
}

// ── Tool Implementations ──

const HONOKA_DIR = process.env.HONOKA_DIR || path.join(require("os").homedir(), "honoka-docs");
const REGISTRY_FILE = path.join(HONOKA_DIR, ".honoka", "notion-registry.json");

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

function okResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// ── Registry (Notion page ID tracking) ──

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(reg) {
  ensureDir(path.dirname(REGISTRY_FILE));
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf8");
}

// ── Path resolution ──

/**
 * Resolve a slug or relative path to an absolute clip path.
 * Returns { found, folderPath, slug } or { found: false }.
 */
function findClipBySlug(slug, clipsDir) {
  const dir = clipsDir || path.join(HONOKA_DIR, "Clips");

  // Direct match: slug is a folder name anywhere in clips tree
  function scan(root, depth) {
    if (depth > 8) return null;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(root, entry.name);
      // Match: folder name equals slug or slug appears at end of relative path
      if (entry.name === slug || full.endsWith(slug)) {
        const indexPath = path.join(full, "index.md");
        if (fs.existsSync(indexPath)) return { folder: full, slug: entry.name };
      }
      const deeper = scan(full, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  }

  // Also try slug as a relative path: dir/slug/index.md
  const asPath = path.join(dir, slug.replace(/\//g, path.sep), "index.md");
  if (fs.existsSync(asPath)) return { folder: path.dirname(asPath), slug: path.basename(path.dirname(asPath)) };

  return scan(dir, 0) || null;
}

// ── read-clip ──

function handleReadClip(id, args) {
  const { slug, directory } = args;
  if (!slug) return sendError(id, -32602, "slug is required");

  const clipsDir = directory || path.join(HONOKA_DIR, "Clips");
  const found = findClipBySlug(slug, clipsDir);
  if (!found) return sendError(id, -32000, `Clip not found: ${slug}`);

  const mdPath = path.join(found.folder, "index.md");
  const md = fs.readFileSync(mdPath, "utf8");

  // List images in assets/ folder
  const assetsDir = path.join(found.folder, "assets");
  const images = [];
  if (fs.existsSync(assetsDir)) {
    const imgs = fs.readdirSync(assetsDir).filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f));
    for (const img of imgs) images.push({ filename: img, path: path.join(assetsDir, img) });
  }

  // Check registry
  const reg = readRegistry();
  const regEntry = reg[found.slug];

  sendResult(id, okResult({
    ok: true,
    slug: found.slug,
    path: mdPath,
    markdown: md,
    images: images.length > 0 ? images : undefined,
    notionPageId: regEntry?.pageId || null,
    notionUrl: regEntry?.notionUrl || null,
    lastNotionSync: regEntry?.lastSync || null,
  }));
}

// ── save-clip (with image support) ──

async function handleSaveClip(id, args) {
  const { title, markdown, url, source, category, images } = args;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "/");
  const slug = slugify(title) || "untitled";
  const folder = path.join(HONOKA_DIR, "Clips", category || "reference", `${dateStr}-${slug}`);
  ensureDir(folder);

  // Save images
  const savedImages = [];
  if (images && images.length > 0) {
    const assetsDir = path.join(folder, "assets");
    ensureDir(assetsDir);
    for (const img of images) {
      if (!img.dataUrl || !img.filename) continue;
      const dataUrlMatch = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!dataUrlMatch) continue;
      const [, mime, b64] = dataUrlMatch;
      const ext = mime.split("/")[1] || "png";
      const fname = img.filename.includes(".") ? img.filename : `${img.filename}.${ext}`;
      const imgPath = path.join(assetsDir, fname);
      try {
        fs.writeFileSync(imgPath, Buffer.from(b64, "base64"));
        savedImages.push({ filename: fname, path: imgPath });
      } catch (e) {
        console.error(`[MCP] Failed to save image ${fname}:`, e.message);
      }
    }
  }

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

  sendResult(id, okResult({
    ok: true,
    path: filePath,
    title,
    slug,
    images: savedImages.length > 0 ? savedImages : undefined,
  }));
}

// ── Notion helpers ──

/** Build a title property value for Notion API. */
function notionTitle(text) {
  return { title: [{ type: "text", text: { content: String(text) } }] };
}

/**
 * Build page properties for a given title.
 * Reads DB schema once per session to determine the title property name.
 */
let _dbTitlePropCache = null;
async function buildProperties(title, databaseId, token) {
  if (!databaseId) return null;
  // Lazily discover the title property name
  if (!_dbTitlePropCache) {
    try {
      const { getDatabaseSchema } = require("./notion");
      const schema = await getDatabaseSchema(databaseId, token);
      for (const [name, def] of Object.entries(schema)) {
        if (def.type === "title") { _dbTitlePropCache = name; break; }
      }
    } catch {}
  }
  const propName = _dbTitlePropCache || "Name";
  return { [propName]: notionTitle(title) };
}

function notionUrl(pageId) {
  return `https://notion.so/${pageId.replace(/-/g, "")}`;
}

// ── push-to-notion (with pageId UPDATE support) ──

async function handlePushToNotion(id, args) {
  const { title, markdown, pageId, notionToken, notionDatabase } = args;
  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;

  if (!token) {
    return sendError(id, -32000, "Notion token not provided. Set NOTION_TOKEN env or pass notionToken.");
  }

  try {
    let finalPageId = pageId || null;
    let action = "created";

    if (finalPageId) {
      // UPDATE existing page
      const props = await buildProperties(title, databaseId, token);
      if (props) await updatePageProperties(finalPageId, props, token);
      await clearPage(finalPageId, token);
      action = "updated";
    } else {
      if (!databaseId) {
        return sendError(id, -32000, "Notion database ID required for CREATE.");
      }
      const props = await buildProperties(title, databaseId, token);
      const page = await createPage({ databaseId, properties: props, token });
      finalPageId = page.id;
    }

    const blocks = toBlocks(markdown);
    await appendBlocks(finalPageId, blocks, token);

    sendResult(id, okResult({
      ok: true,
      pageId: finalPageId,
      title,
      action,
      blockCount: blocks.length,
      notionUrl: notionUrl(finalPageId),
    }));
  } catch (err) {
    sendError(id, -32000, `Notion push failed: ${err.message}`);
  }
}

// ── save-and-push ──

async function handleSaveAndPush(id, args) {
  const { title, markdown, url, source, category, images, notionToken, notionDatabase } = args;

  // Step 1: Save locally
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "/");
  const slug = slugify(title) || "untitled";
  const folder = path.join(HONOKA_DIR, "Clips", category || "reference", `${dateStr}-${slug}`);
  ensureDir(folder);

  if (images && images.length > 0) {
    const assetsDir = path.join(folder, "assets");
    ensureDir(assetsDir);
    for (const img of images) {
      if (!img.dataUrl || !img.filename) continue;
      const m = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) continue;
      const ext = m[1].split("/")[1] || "png";
      const fname = img.filename.includes(".") ? img.filename : `${img.filename}.${ext}`;
      try { fs.writeFileSync(path.join(assetsDir, fname), Buffer.from(m[2], "base64")); } catch {}
    }
  }

  const filePath = path.join(folder, "index.md");
  const fm = [`---`, `title: "${title.replace(/"/g, '\\"')}"`, `date: ${now.toISOString()}`];
  if (url) fm.push(`source: ${url}`);
  fm.push(`category: ${category || "reference"}`, `---`, ``);
  fs.writeFileSync(filePath, fm.join("\n") + markdown, "utf8");

  // Step 2: Push to Notion with registry tracking
  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;
  if (!token || !databaseId) {
    return sendResult(id, okResult({
      ok: true,
      saved: true,
      pushed: false,
      reason: "Notion credentials not configured. Set NOTION_TOKEN + NOTION_DATABASE env.",
      slug,
      path: filePath,
    }));
  }

  try {
    const reg = readRegistry();
    const existing = reg[slug];
    const props = await buildProperties(title, databaseId, token);
    let finalPageId, action;

    if (existing?.pageId) {
      await updatePageProperties(existing.pageId, props, token);
      await clearPage(existing.pageId, token);
      finalPageId = existing.pageId;
      action = "updated";
    } else {
      // Check Notion DB for existing
      const titleProp = Object.keys(props)[0];
      const matches = await queryDatabase(databaseId, {
        property: titleProp,
        title: { equals: title },
      }, token);
      if (matches.length > 0) {
        finalPageId = matches[0].id;
        await updatePageProperties(finalPageId, props, token);
        await clearPage(finalPageId, token);
        action = "updated";
      } else {
        const page = await createPage({ databaseId, properties: props, token });
        finalPageId = page.id;
        action = "created";
      }
    }

    const blocks = toBlocks(markdown);
    await appendBlocks(finalPageId, blocks, token);

    // Update registry
    const url = notionUrl(finalPageId);
    reg[slug] = { pageId: finalPageId, notionUrl: url, title, lastSync: new Date().toISOString() };
    writeRegistry(reg);

    sendResult(id, okResult({
      ok: true,
      saved: true,
      pushed: true,
      action,
      slug,
      path: filePath,
      pageId: finalPageId,
      notionUrl: url,
      blockCount: blocks.length,
    }));
  } catch (err) {
    sendError(id, -32000, `Push failed (local file saved): ${err.message}`);
  }
}

// ── sync-clip ──

async function handleSyncClip(id, args) {
  const { slug, notionToken, notionDatabase } = args;
  if (!slug) return sendError(id, -32602, "slug is required");

  const found = findClipBySlug(slug);
  if (!found) return sendError(id, -32000, `Clip not found: ${slug}`);

  const mdPath = path.join(found.folder, "index.md");
  const md = fs.readFileSync(mdPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(md);
  const title = frontmatter.title || found.slug;

  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;
  if (!token || !databaseId) {
    return sendError(id, -32000, "Notion credentials not configured.");
  }

  try {
    const reg = readRegistry();
    const existing = reg[found.slug];
    const props = await buildProperties(title, databaseId, token);
    let finalPageId, action;

    if (existing?.pageId) {
      await updatePageProperties(existing.pageId, props, token);
      await clearPage(existing.pageId, token);
      finalPageId = existing.pageId;
      action = "updated";
    } else {
      const titleProp = Object.keys(props)[0];
      const matches = await queryDatabase(databaseId, {
        property: titleProp,
        title: { equals: title },
      }, token);
      if (matches.length > 0) {
        finalPageId = matches[0].id;
        await updatePageProperties(finalPageId, props, token);
        await clearPage(finalPageId, token);
        action = "updated";
      } else {
        const page = await createPage({ databaseId, properties: props, token });
        finalPageId = page.id;
        action = "created";
      }
    }

    const blocks = toBlocks(body);
    await appendBlocks(finalPageId, blocks, token);

    const url = notionUrl(finalPageId);
    reg[found.slug] = { pageId: finalPageId, notionUrl: url, title, lastSync: new Date().toISOString() };
    writeRegistry(reg);

    sendResult(id, okResult({
      ok: true,
      slug: found.slug,
      action,
      pageId: finalPageId,
      notionUrl: url,
      blockCount: blocks.length,
    }));
  } catch (err) {
    sendError(id, -32000, `Sync failed: ${err.message}`);
  }
}

// ── query-notion ──

async function handleQueryNotion(id, args) {
  const { query, limit, notionToken, notionDatabase } = args;
  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;

  if (!token) {
    return sendError(id, -32000, "Notion token not provided. Set NOTION_TOKEN env or pass notionToken.");
  }
  if (!databaseId) {
    return sendError(id, -32000, "Notion database ID not provided. Set NOTION_DATABASE env or pass notionDatabase.");
  }

  try {
    const { getDatabaseSchema, queryDatabase } = require("./notion");
    const schema = await getDatabaseSchema(databaseId, token);
    const titleProp = Object.entries(schema).find(([, d]) => d.type === "title")?.[0] || "Name";

    const filter = query
      ? { property: titleProp, title: { contains: query } }
      : undefined;
    const results = await queryDatabase(databaseId, filter, token, limit || 20);

    const pages = results.map((p) => {
      const title = p.properties?.[titleProp]?.title?.map((t) => t.plain_text).join("") || "Untitled";
      return { id: p.id, title, url: p.url };
    });

    sendResult(id, okResult({ ok: true, total: pages.length, databaseId, pages }));
  } catch (err) {
    sendError(id, -32000, `Query failed: ${err.message}`);
  }
}

// ── sync-directory ──

async function handleSyncDirectory(id, args) {
  const { directory, notionToken, notionDatabase } = args;
  const token = notionToken || process.env.NOTION_TOKEN;
  const databaseId = notionDatabase || process.env.NOTION_DATABASE;

  if (!token) return sendError(id, -32000, "Notion token not provided.");
  if (!databaseId) return sendError(id, -32000, "Notion database ID not provided.");

  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) return sendError(id, -32000, `Directory not found: ${resolved}`);

  try {
    const result = await syncDirectory(resolved, { notionToken: token, notionDatabase: databaseId, verbose: false });
    sendResult(id, okResult({ ok: true, directory: resolved, synced: result.synced, skipped: result.skipped, errors: result.errors }));
  } catch (err) {
    sendError(id, -32000, `Sync failed: ${err.message}`);
  }
}

// ── list-docs ──

function handleListDocs(id, args) {
  const clipsDir = args.directory || path.join(HONOKA_DIR, "Clips");

  if (!fs.existsSync(clipsDir)) {
    return sendResult(id, okResult({ ok: true, docs: [], dir: clipsDir }));
  }

  const reg = readRegistry();
  const docs = [];
  function walk(dir, depth = 0) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name === "index.md") {
        const rel = path.relative(clipsDir, full);
        const stat = fs.statSync(full);
        const parentName = path.basename(path.dirname(full));
        const regEntry = reg[parentName];
        docs.push({
          slug: parentName,
          path: rel,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          notionPageId: regEntry?.pageId || null,
          notionUrl: regEntry?.notionUrl || null,
        });
      }
    }
  }
  walk(clipsDir);

  docs.sort((a, b) => b.modified.localeCompare(a.modified));
  const total = docs.length;
  sendResult(id, okResult({ ok: true, total, docs: docs.slice(0, 20), dir: clipsDir }));
}

// ── Entry ──

// ── AnyType handlers ──

function anytypeCreds(args) {
  return {
    apiKey: args.anytypeApiKey || process.env.HONOKA_ANYTYPE_API_KEY || "",
    spaceId: args.anytypeSpaceId || process.env.HONOKA_ANYTYPE_SPACE_ID || "",
  };
}

async function handleSyncToAnytype(id, args) {
  const { slug } = args;
  if (!slug) return sendError(id, -32602, "slug is required");

  const found = findClipBySlug(slug);
  if (!found) return sendError(id, -32000, `Document not found: ${slug}`);

  const creds = anytypeCreds(args);
  if (!creds.apiKey || !creds.spaceId) {
    return sendError(id, -32000, "AnyType not configured. Set HONOKA_ANYTYPE_API_KEY + HONOKA_ANYTYPE_SPACE_ID env vars.");
  }

  try {
    const mdPath = path.join(found.folder, "index.md");
    const md = fs.readFileSync(mdPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(md);
    const title = frontmatter.title || found.slug;

    const reg = readRegistry();
    const existing = reg[found.slug];
    const opts = { apiKey: creds.apiKey, spaceId: creds.spaceId };

    let result;
    if (existing?.anytypeObjectId) {
      result = await updateAnytype({
        objectId: existing.anytypeObjectId,
        title,
        markdown: body,
        category: frontmatter.category || "reference",
        opts,
      });
    } else {
      result = await anytypeCreate({
        title,
        markdown: body,
        category: frontmatter.category || "reference",
        opts,
      });
    }

    if (!result.ok) {
      return sendError(id, -32000, `AnyType sync failed: ${result.error}`);
    }

    // Update registry with AnyType object ID
    reg[found.slug] = {
      ...(reg[found.slug] || {}),
      anytypeObjectId: result.objectId,
      lastAnytypeSync: new Date().toISOString(),
    };
    writeRegistry(reg);

    sendResult(id, okResult({
      ok: true,
      slug: found.slug,
      objectId: result.objectId,
      action: existing?.anytypeObjectId ? "updated" : "created",
    }));
  } catch (err) {
    sendError(id, -32000, `AnyType sync failed: ${err.message}`);
  }
}

async function handleSearchAnytype(id, args) {
  const { query, limit } = args;
  if (!query) return sendError(id, -32602, "query is required");

  const creds = anytypeCreds(args);
  if (!creds.apiKey || !creds.spaceId) {
    return sendError(id, -32000, "AnyType not configured.");
  }

  try {
    const result = await searchAnytype({
      query,
      limit: limit || 20,
      opts: { apiKey: creds.apiKey, spaceId: creds.spaceId },
    });
    if (!result.ok) return sendError(id, -32000, `Search failed: ${result.error}`);

    sendResult(id, okResult({ ok: true, objects: result.objects, count: result.count }));
  } catch (err) {
    sendError(id, -32000, `Search failed: ${err.message}`);
  }
}

async function handleReadAnytype(id, args) {
  const { objectId } = args;
  if (!objectId) return sendError(id, -32602, "objectId is required");

  const creds = anytypeCreds(args);
  if (!creds.apiKey || !creds.spaceId) {
    return sendError(id, -32000, "AnyType not configured.");
  }

  try {
    const result = await getAnytypeObject(objectId, {
      apiKey: creds.apiKey,
      spaceId: creds.spaceId,
    });
    if (!result.ok) return sendError(id, -32000, `Read failed: ${result.error}`);

    sendResult(id, okResult({ ok: true, object: result.object }));
  } catch (err) {
    sendError(id, -32000, `Read failed: ${err.message}`);
  }
}

async function handleDeleteAnytype(id, args) {
  const { objectId } = args;
  if (!objectId) return sendError(id, -32602, "objectId is required");

  const creds = anytypeCreds(args);
  if (!creds.apiKey || !creds.spaceId) {
    return sendError(id, -32000, "AnyType not configured.");
  }

  try {
    const result = await deleteAnytypeObject(objectId, {
      apiKey: creds.apiKey,
      spaceId: creds.spaceId,
    });
    if (!result.ok) return sendError(id, -32000, `Delete failed: ${result.error}`);

    sendResult(id, okResult({ ok: true, objectId, deleted: true }));
  } catch (err) {
    sendError(id, -32000, `Delete failed: ${err.message}`);
  }
}

function runMCP() {
  // MCP uses stderr for logging, stdout for protocol
  console.error("[honoka-publish] MCP server starting, protocol version:", PROTOCOL_VERSION);
  startStdioServer();
}

module.exports = { runMCP };
