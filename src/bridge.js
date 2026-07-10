/**
 * Bridge HTTP server — backward-compatible with the original honoka-bridge API.
 *
 * Provides a REST API on port 44124 for the Chrome Extension to:
 *   - Save clips to local disk
 *   - Save and push to Notion / AnyType
 *   - List saved documents
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const { createPage, appendBlocks } = require("./notion");
const { toBlocks } = require("./markdown");

const PKG = require("../package.json");
const VERSION = PKG.version;

const HONOKA_DIR = process.env.HONOKA_DIR || path.join(require("os").homedir(), "honoka-docs");
const DEFAULT_PORT = 44124;

// ── Helpers ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

// ── Settings (persisted as JSON in HONOKA_DIR) ──

const SETTINGS_FILE = path.join(HONOKA_DIR, ".honoka", "bridge-settings.json");

function ensureSettingsDir() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(data) {
  ensureSettingsDir();
  const current = loadSettings();
  const merged = { ...current, ...data };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

// ── Handlers ──

function handleStatus(req, res, port) {
  const settings = loadSettings();
  json(res, 200, {
    ok: true,
    version: VERSION,
    docsDir: HONOKA_DIR,
    port: port || DEFAULT_PORT,
    pid: process.pid,
    integrations: {
      notion: !!(settings.notionPat || process.env.NOTION_TOKEN),
      anytype: !!settings.anytypeApiKey,
    },
  });
}

async function handleSave(req, res) {
  try {
    const body = await readBody(req);
    const { title, markdown, url, source, category } = body;
    if (!title || !markdown) {
      return json(res, 400, { error: "title and markdown required" });
    }

    const now = new Date();
    const dateSlug = now.toISOString().slice(0, 10).replace(/-/g, "/");
    const slug = slugify(title) || "untitled";
    const folder = path.join(HONOKA_DIR, "Clips", category || "reference", `${dateSlug}-${slug}`);
    fs.mkdirSync(folder, { recursive: true });

    const filePath = path.join(folder, "index.md");
    const frontmatter = [
      "---",
      `title: "${title.replace(/"/g, '\\"')}"`,
      `date: ${now.toISOString()}`,
      url ? `source: ${url}` : null,
      `category: ${category || "reference"}`,
      `source: ${source || "extension"}`,
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    fs.writeFileSync(filePath, frontmatter + markdown, "utf8");

    json(res, 200, { ok: true, path: filePath, slug, folder });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

async function handleSaveAndNotion(req, res) {
  try {
    const body = await readBody(req);
    const { title, markdown, url, source, notionToken, notionDatabase } = body;

    const token = notionToken || process.env.NOTION_TOKEN;
    const databaseId = notionDatabase || process.env.NOTION_DATABASE;
    const settings = loadSettings();
    const effToken = token || settings.notionPat;
    const effDb = databaseId || settings.notionDatabaseId;

    if (!effToken) return json(res, 400, { error: "Notion token not configured" });
    if (!effDb) return json(res, 400, { error: "Notion database ID not configured" });

    // Save to disk first
    const now = new Date();
    const dateSlug = now.toISOString().slice(0, 10).replace(/-/g, "/");
    const slug = slugify(title) || "untitled";
    const folder = path.join(HONOKA_DIR, "Clips", "reference", `${dateSlug}-${slug}`);
    fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, "index.md");
    const frontmatter = [
      "---",
      `title: "${title.replace(/"/g, '\\"')}"`,
      `date: ${now.toISOString()}`,
      url ? `source: ${url}` : null,
      "---", "",
    ].filter(Boolean).join("\n");
    fs.writeFileSync(filePath, frontmatter + markdown, "utf8");

    // Push to Notion
    const page = await createPage(effToken, effDb, { title });
    const blocks = toBlocks(markdown);
    if (blocks.length > 0) await appendBlocks(effToken, page.id, blocks);

    json(res, 200, {
      ok: true,
      path: filePath,
      pageId: page.id,
      notionUrl: `https://notion.so/${page.id.replace(/-/g, "")}`,
      blockCount: blocks.length,
    });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

async function handleSaveAndAnytype(req, res) {
  try {
    const body = await readBody(req);
    const { title, markdown } = body;
    if (!title || !markdown) return json(res, 400, { error: "title and markdown required" });

    const settings = loadSettings();
    const apiKey = settings.anytypeApiKey;
    const spaceId = settings.anytypeSpaceId;
    const apiUrl = settings.anytypeApiUrl;

    if (!apiKey || !spaceId) return json(res, 400, { error: "AnyType not configured" });

    // Save to disk first
    const now = new Date();
    const slug = slugify(title) || "untitled";
    const folder = path.join(HONOKA_DIR, "Clips", "anytype", `${now.toISOString().slice(0, 10)}-${slug}`);
    fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, "index.md");
    const frontmatter = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${now.toISOString()}\n---\n\n`;
    fs.writeFileSync(filePath, frontmatter + markdown, "utf8");

    // Push to AnyType via REST API
    const axios = require("axios");
    const anytypeBody = {
      title,
      markdown,
      spaceId,
      apiKey,
    };
    const targetUrl = apiUrl || "http://127.0.0.1:31009";
    const response = await axios.post(`${targetUrl}/v1/objects`, anytypeBody, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });

    json(res, 200, { ok: true, path: filePath, anytype: response.data });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    json(res, 400, { error: `AnyType push failed: ${msg}` });
  }
}

function handleSettingsGet(req, res) {
  const settings = loadSettings();
  // Don't expose secrets in response unless explicitly requested
  const safe = {
    anytypeApiUrl: settings.anytypeApiUrl || "",
    anytypeSpaceId: settings.anytypeSpaceId ? "••••" + settings.anytypeSpaceId.slice(-4) : "",
    notionPat: settings.notionPat ? "••••" + settings.notionPat.slice(-4) : "",
    notionDatabaseId: settings.notionDatabaseId || "",
    bridgeUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
  };
  json(res, 200, { ok: true, settings: safe });
}

async function handleSettingsPost(req, res) {
  try {
    const body = await readBody(req);
    const ALLOWED = ["notionPat", "notionDatabaseId", "anytypeApiKey", "anytypeSpaceId", "anytypeApiUrl"];
    const toSave = {};
    for (const key of ALLOWED) {
      if (key in body) toSave[key] = body[key];
    }
    const result = saveSettings(toSave);
    json(res, 200, { ok: true, changed: Object.keys(toSave).length > 0 });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

function extractFrontmatterField(filePath, field) {
  try {
    const content = fs.readFileSync(filePath, "utf8").slice(0, 4096);
    const match = content.match(new RegExp(`^${field}:\\s*(.+)\\s*$`, "m"));
    return match ? match[1].trim() : "";
  } catch { return ""; }
}

async function handleList(req, res) {
  const clipsDir = path.join(HONOKA_DIR, "Clips");
  const docs = [];
  if (fs.existsSync(clipsDir)) {
    const categories = fs.readdirSync(clipsDir, { withFileTypes: true });
    for (const cat of categories) {
      if (!cat.isDirectory() || cat.name.startsWith(".")) continue;
      const catPath = path.join(clipsDir, cat.name);
      walkDir(catPath, docs, cat.name, HONOKA_DIR);
    }
  }
  docs.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  json(res, 200, { docs, docsDir: HONOKA_DIR, count: docs.length });
}

function walkDir(dirPath, docs, category, baseDir) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const subPath = path.join(dirPath, entry.name);
    const indexPath = path.join(subPath, "index.md");
    if (fs.existsSync(indexPath)) {
      const stat = fs.statSync(indexPath);
      const source = extractFrontmatterField(indexPath, "source");
      docs.push({
        title: entry.name,
        path: path.relative(baseDir, subPath),
        category,
        lastModified: stat.mtime.toISOString(),
        size: stat.size,
        source,
      });
    } else {
      // Recurse into subdirectory (handles Clips/category/YYYY/MM/date-slug/ structure)
      walkDir(subPath, docs, category, baseDir);
    }
  }
}

// ── Request Router ──

function createServer(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);
    const route = url.pathname;

    try {
      // Core extension API
      if (route === "/status" && req.method === "GET") return handleStatus(req, res, port);
      if (route === "/api/save" && req.method === "POST") return await handleSave(req, res);
      if (route === "/api/save-and-notion" && req.method === "POST") return await handleSaveAndNotion(req, res);
      if (route === "/api/save-and-anytype" && req.method === "POST") return await handleSaveAndAnytype(req, res);
      if (route === "/api/settings" && req.method === "GET") return handleSettingsGet(req, res);
      if (route === "/api/settings" && req.method === "POST") return await handleSettingsPost(req, res);
      if (route === "/api/docs" && req.method === "GET") return handleList(req, res);

      // Legacy endpoints (old Bridge compatibility)
      if (route === "/save" && req.method === "POST") return await handleSave(req, res);
      if (route === "/list" && req.method === "GET") return handleList(req, res);
      if (route === "/settings" && req.method === "GET") return handleSettingsGet(req, res);
      if (route === "/settings" && req.method === "POST") return await handleSettingsPost(req, res);

      // Static file serving
      if (route.startsWith("/files/")) {
        const relPath = decodeURIComponent(route.slice(7));
        if (relPath.includes("..")) return json(res, 400, { error: "invalid path" });
        const filePath = path.join(HONOKA_DIR, relPath);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        cors(res);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      json(res, 404, { error: "not found", route });
    } catch (err) {
      console.error("[Bridge] Error:", err.message);
      json(res, 500, { error: err.message });
    }
  });

  return server;
}

function runBridge(port = DEFAULT_PORT) {
  const server = createServer(port);
  server.listen(port, "127.0.0.1", () => {
    console.error(`[honoka-publish] Bridge server running on http://127.0.0.1:${port}`);
    console.error(`[honoka-publish] Docs directory: ${HONOKA_DIR}`);
  });
  return server;
}

module.exports = { runBridge, createServer };
