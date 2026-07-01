/**
 * Notion API client.
 *
 * Clean-room implementation based solely on Notion's public REST API documentation:
 *   https://developers.notion.com/reference
 *
 * Supports: page creation, property updates, block appending, Direct Upload for images.
 */
const https = require("https");
const http = require("http");
const { URL } = require("url");

const API_BASE = "https://api.notion.com/v1";
const API_VERSION = "2022-06-28";

// ── Low-level HTTP helper ──────────────────────────────────────────

/**
 * Make a JSON HTTP request to Notion API.
 * @param {"GET"|"POST"|"PATCH"|"PUT"|"DELETE"} method
 * @param {string} path - e.g. "/pages" or "/databases/:id"
 * @param {object} options
 * @param {string} options.token - Notion PAT
 * @param {object} [options.body] - JSON body
 * @param {string} [options.baseUrl] - Override for file uploads
 * @returns {Promise<object>}
 */
function notionFetch(method, path, { token, body, baseUrl } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl || API_BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": API_VERSION,
        "Content-Type": "application/json",
      },
    };

    const transport = (url.protocol === "http:" ? http : https);

    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) {
          let detail = raw.slice(0, 300);
          try {
            const parsed = JSON.parse(raw);
            detail = parsed.message || parsed.code || detail;
          } catch { /* keep raw */ }
          return reject(new Error(`Notion ${res.statusCode}: ${detail}`));
        }
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid JSON from Notion: ${raw.slice(0, 100)}`));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`Request failed: ${err.message}`)));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Database schema ──────────────────────────────────────────────

/**
 * Retrieve database metadata including property definitions.
 * @param {string} databaseId
 * @param {string} token
 * @returns {Promise<object>} - Map of property name → property definition
 */
async function getDatabaseSchema(databaseId, token) {
  const data = await notionFetch("GET", `/databases/${databaseId}`, { token });
  return data.properties || {};
}

// ── Page operations ──────────────────────────────────────────────

/**
 * Create a new page inside a database.
 * @param {object} params
 * @param {string} params.databaseId
 * @param {object} params.properties - Notion property values
 * @param {string} params.token
 * @returns {Promise<{id: string, url: string}>}
 */
async function createPage({ databaseId, properties, token }) {
  const data = await notionFetch("POST", "/pages", {
    token,
    body: {
      parent: { type: "database_id", database_id: databaseId },
      properties,
    },
  });
  return { id: data.id, url: `https://notion.so/${data.id.replace(/-/g, "")}` };
}

/**
 * Update an existing page's properties.
 * @param {string} pageId
 * @param {object} properties
 * @param {string} token
 */
async function updatePageProperties(pageId, properties, token) {
  await notionFetch("PATCH", `/pages/${pageId}`, {
    token,
    body: { properties },
  });
}

/**
 * Append children blocks to a page.
 * @param {string} pageId
 * @param {object[]} blocks - Array of Notion block objects
 * @param {string} token
 */
async function appendBlocks(pageId, blocks, token) {
  // Notion accepts max 100 blocks per request
  const CHUNK = 100;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const chunk = blocks.slice(i, i + CHUNK);
    await notionFetch("PATCH", `/blocks/${pageId}/children`, {
      token,
      body: { children: chunk },
    });
  }
}

/**
 * Archive all existing children blocks of a page (for content replacement).
 * @param {string} pageId
 * @param {string} token
 */
async function clearPage(pageId, token) {
  const data = await notionFetch("GET", `/blocks/${pageId}/children?page_size=100`, { token });
  const children = data.results || [];
  for (const block of children) {
    try {
      await notionFetch("PATCH", `/blocks/${block.id}`, {
        token,
        body: { archived: true },
      });
    } catch (err) {
      console.warn(`  [warn] Failed to archive block ${block.id}: ${err.message}`);
    }
  }
}

/**
 * Query a database to find existing pages (e.g., by title or slug).
 * @param {string} databaseId
 * @param {object} filter - Notion filter object
 * @param {string} token
 * @returns {Promise<object[]>}
 */
async function queryDatabase(databaseId, filter, token) {
  const data = await notionFetch("POST", `/databases/${databaseId}/query`, {
    token,
    body: { filter },
  });
  return data.results || [];
}

// ── File upload ──────────────────────────────────────────────────

/**
 * Upload an image file to Notion via Direct Upload API.
 * Returns a file ID that can be used in image blocks.
 *
 * Reference: https://developers.notion.com/reference/file-upload
 *
 * @param {Buffer} buffer - File content
 * @param {string} filename - e.g. "photo.png"
 * @param {string} contentType - MIME type
 * @param {string} token
 * @returns {Promise<string>} - Notion file ID
 */
async function uploadFile(buffer, filename, contentType, token) {
  // Step 1: Request upload URL
  const uploadReq = await notionFetch("POST", "/files", {
    token,
    body: {
      name: filename,
      size: buffer.length,
      contentType,
    },
  });

  const uploadUrl = uploadReq.uploadUrl;
  const fileId = uploadReq.id;
  if (!uploadUrl) {
    throw new Error("No upload URL returned from Notion");
  }

  // Step 2: PUT file content to upload URL
  await new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const transport = (u.protocol === "http:" ? http : https);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length,
      },
    };

    const req = transport.request(opts, (res) => {
      // Collect response body for debugging
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 300) {
          const body = Buffer.concat(chunks).toString().slice(0, 200);
          return reject(new Error(`Upload failed (${res.statusCode}): ${body}`));
        }
        resolve();
      });
    });
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });

  return fileId;
}

module.exports = {
  notionFetch,
  getDatabaseSchema,
  createPage,
  updatePageProperties,
  appendBlocks,
  clearPage,
  queryDatabase,
  uploadFile,
};
