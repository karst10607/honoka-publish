/**
 * Joplin output integration — local Joplin Clipper REST API.
 *
 * API form probed 2026-11-09 against Joplin desktop 3.7.22 on 127.0.0.1:41184:
 * REST routes with ?token= query auth (matches the joplin upstream in mabi's
 * daemon config, tokenIn: "query"). Notes are created in a configured
 * notebook; files are uploaded as resources and linked via ![](:/id).
 * When Joplin is unreachable, saveToJoplin falls back to a local inbox file.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_TIMEOUT_MS = 15000;

function redactUrl(text) {
  return String(text).replace(/token=[^&\s"')]+/gi, "token=***");
}

function createClient({ apiUrl, token, notebookId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiUrl || !token) {
    throw new Error("Joplin not configured (joplinApiUrl / joplinToken)");
  }
  const base = apiUrl.replace(/\/+$/, "");

  async function api(method, route, { query = {}, body, form } = {}) {
    const url = new URL(base + route);
    url.searchParams.set("token", token);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const opts = { method, signal: AbortSignal.timeout(timeoutMs) };
    if (form) {
      opts.body = form;
    } else if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      throw new Error(redactUrl(`Joplin request failed: ${err.message}`));
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(redactUrl(`Joplin ${res.status}: ${text.slice(0, 200)}`));
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  return {
    createNote({ title, body }) {
      return api("POST", "/notes", { body: { title, body, parent_id: notebookId } });
    },
    getNote(id) {
      return api("GET", `/notes/${id}`, { query: { fields: "id,title,body,parent_id" } });
    },
    deleteNote(id) {
      return api("DELETE", `/notes/${id}`, { query: { permanent: "1" } });
    },
    createResource(filePath, title) {
      const form = new FormData();
      form.append("props", JSON.stringify({ title: title || path.basename(filePath) }));
      // Joplin's ClipperServer only reads the multipart file field named "data".
      form.append("data", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
      return api("POST", "/resources", { form });
    },
    deleteResource(id) {
      return api("DELETE", `/resources/${id}`, { query: { permanent: "1" } });
    },
  };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80) || "untitled";
}

function writeInboxFallback({ title, markdown, sourceUrl, files = [], error }, inboxDir) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(inboxDir, `${stamp}-${slugify(title)}.md`);
  const frontmatter = [
    "---",
    `title: "${String(title).replace(/"/g, '\\"')}"`,
    `date: ${new Date().toISOString()}`,
    sourceUrl ? `source: ${sourceUrl}` : null,
    `fallback_reason: "${redactUrl(error).replace(/"/g, '\\"')}"`,
    files.length ? `attachments: ${files.join(", ")}` : null,
    "---",
    "",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(filePath, frontmatter + (markdown || ""), "utf8");
  return filePath;
}

/**
 * Save an article (with optional file attachments) to Joplin.
 * On any failure, writes a local inbox markdown instead and returns
 * { ok: false, fallback: "inbox", inboxPath, error }.
 */
async function saveToJoplin({ title, markdown, sourceUrl, files = [] }, config, { inboxDir } = {}) {
  if (!inboxDir) throw new Error("inboxDir required");
  const resourceIds = [];
  let client;
  try {
    client = createClient(config);
    let body = markdown || "";
    for (const file of files) {
      const resource = await client.createResource(file);
      resourceIds.push(resource.id);
      body += `\n\n![${path.basename(file)}](:/${resource.id})`;
    }
    if (sourceUrl) body += `\n\n---\nSource: ${sourceUrl}`;
    const note = await client.createNote({ title, body });
    return { ok: true, noteId: note.id, resourceIds };
  } catch (err) {
    // Best-effort cleanup of resources uploaded before the failure.
    for (const id of resourceIds) {
      try { await client.deleteResource(id); } catch { /* Joplin may be down */ }
    }
    const inboxPath = writeInboxFallback({ title, markdown, sourceUrl, files, error: err.message }, inboxDir);
    return { ok: false, fallback: "inbox", inboxPath, error: redactUrl(err.message) };
  }
}

module.exports = { createClient, saveToJoplin, writeInboxFallback, redactUrl };
