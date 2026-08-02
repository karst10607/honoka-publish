/**
 * Anytype integration — full CRUD for syncing documents to Anytype.
 *
 * Credentials are read from env vars:
 *   HONOKA_ANYTYPE_API_KEY  – Anytype API key
 *   HONOKA_ANYTYPE_SPACE_ID – Anytype space ID
 *   HONOKA_ANYTYPE_API_URL  – API base URL (default: http://127.0.0.1:31009)
 *
 * Can also be passed explicitly via opts for programmatic use.
 */
const axios = require("axios");

const DEFAULT_API_URL = "http://127.0.0.1:31009";
const API_VERSION = "2025-11-08";

const TYPE_MAP = {
  article: "note",
  "real-estate": "note",
  bookmark: "bookmark",
  video: "note",
  default: "note",
};

// ── Credential resolution ──────────────────────────────────────

function resolveCreds(opts) {
  const apiKey = opts.apiKey || process.env.HONOKA_ANYTYPE_API_KEY || "";
  const spaceId = opts.spaceId || process.env.HONOKA_ANYTYPE_SPACE_ID || "";
  const apiUrl = opts.apiUrl || process.env.HONOKA_ANYTYPE_API_URL || DEFAULT_API_URL;
  if (!apiKey || !spaceId) {
    return { ok: false, error: "Anytype not configured. Set HONOKA_ANYTYPE_API_KEY + HONOKA_ANYTYPE_SPACE_ID env vars." };
  }
  return {
    ok: true,
    apiUrl,
    spaceId,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Anytype-Version": API_VERSION,
      "Content-Type": "application/json",
    },
  };
}

function resolveObjectType(category) {
  return TYPE_MAP[category] || TYPE_MAP.default;
}

// ── CREATE ─────────────────────────────────────────────────────

/**
 * Create a new AnyType object.
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.markdown] - Markdown body content
 * @param {string} [params.category] - Document category
 * @param {object} [params.opts] - Override credentials { apiKey, spaceId, apiUrl }
 * @returns {Promise<{ok: boolean, objectId?: string, error?: string}>}
 */
async function saveToAnytype({ title, markdown, category, opts }) {
  const creds = resolveCreds(opts || {});
  if (!creds.ok) return creds;
  const { apiUrl, spaceId, headers } = creds;

  try {
    const body = {
      name: title,
      type_key: resolveObjectType(category),
      body: markdown || "",
    };

    const resp = await axios.post(
      `${apiUrl}/v1/spaces/${spaceId}/objects`,
      body,
      { headers, timeout: 10000 }
    );

    const objectId = resp.data?.object?.id;
    if (!objectId) return { ok: false, error: "No object ID in response" };

    console.error(`[Anytype] Created: ${objectId}`);
    return { ok: true, objectId };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error("[Anytype] Create failed:", msg);
    return { ok: false, error: msg };
  }
}

// ── UPDATE ─────────────────────────────────────────────────────

/**
 * Update an existing AnyType object.
 * Falls back to create if no objectId provided.
 */
async function updateAnytype({ objectId, title, markdown, category, opts }) {
  if (!objectId) return saveToAnytype({ title, markdown, category, opts });

  const creds = resolveCreds(opts || {});
  if (!creds.ok) return creds;
  const { apiUrl, spaceId, headers } = creds;

  try {
    const body = {
      name: title,
      type_key: resolveObjectType(category),
      body: markdown || "",
    };

    await axios.put(
      `${apiUrl}/v1/spaces/${spaceId}/objects/${objectId}`,
      body,
      { headers, timeout: 10000 }
    );

    console.error(`[Anytype] Updated: ${objectId}`);
    return { ok: true, objectId };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error("[Anytype] Update failed:", msg);
    return { ok: false, error: msg, objectId };
  }
}

// ── READ ───────────────────────────────────────────────────────

async function getAnytypeObject(objectId, opts) {
  const creds = resolveCreds(opts || {});
  if (!creds.ok) return creds;
  const { apiUrl, spaceId, headers } = creds;

  try {
    const resp = await axios.get(
      `${apiUrl}/v1/spaces/${spaceId}/objects/${objectId}`,
      { headers, timeout: 10000 }
    );
    return { ok: true, object: resp.data?.object || resp.data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error("[Anytype] Read failed:", msg);
    return { ok: false, error: msg };
  }
}

// ── SEARCH ─────────────────────────────────────────────────────

async function searchAnytype({ query, limit, offset, opts }) {
  const creds = resolveCreds(opts || {});
  if (!creds.ok) return creds;
  const { apiUrl, spaceId, headers } = creds;

  try {
    const resp = await axios.post(
      `${apiUrl}/v1/spaces/${spaceId}/search`,
      { query, limit: limit || 20, offset: offset || 0 },
      { headers, timeout: 10000 }
    );
    const objects = resp.data?.objects || resp.data?.results || [];
    return { ok: true, objects, count: objects.length };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error("[Anytype] Search failed:", msg);
    return { ok: false, error: msg };
  }
}

// ── DELETE ─────────────────────────────────────────────────────

async function deleteAnytypeObject(objectId, opts) {
  const creds = resolveCreds(opts || {});
  if (!creds.ok) return creds;
  const { apiUrl, spaceId, headers } = creds;

  try {
    await axios.delete(
      `${apiUrl}/v1/spaces/${spaceId}/objects/${objectId}`,
      { headers, timeout: 10000 }
    );
    console.error(`[Anytype] Deleted: ${objectId}`);
    return { ok: true, objectId };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error("[Anytype] Delete failed:", msg);
    return { ok: false, error: msg };
  }
}

// ── Legacy (backward-compat for bridge.js) ─────────────────────

/**
 * @deprecated Use saveToAnytype() instead.
 * Publish a document to Anytype with explicit config object.
 */
async function publishToAnytype({ title, body, url, category, properties, config }) {
  const apiKey = config?.apiKey || process.env.HONOKA_ANYTYPE_API_KEY;
  const spaceId = config?.spaceId || process.env.HONOKA_ANYTYPE_SPACE_ID;
  const apiUrl = config?.apiUrl || process.env.HONOKA_ANYTYPE_API_URL || DEFAULT_API_URL;
  if (!apiKey || !spaceId) {
    return { ok: false, error: "Anytype not configured" };
  }

  const typeKey = resolveObjectType(category);

  try {
    const createResp = await axios.post(
      `${apiUrl}/v1/spaces/${spaceId}/objects`,
      { name: title, type_key: typeKey, body: body || "" },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Anytype-Version": API_VERSION,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const objectId = createResp.data?.object?.id;
    if (!objectId) return { ok: false, error: "No object ID in response" };

    // Add to collection if configured
    const collections = config?.collections || {};
    const collectionId = collections[category] || collections.default;
    if (collectionId) {
      try {
        await axios.post(
          `${apiUrl}/v1/spaces/${spaceId}/lists/${collectionId}/objects`,
          [objectId],
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Anytype-Version": API_VERSION,
            },
            timeout: 5000,
          }
        );
      } catch (listErr) {
        console.warn(`[Anytype] Collection add failed: ${listErr.message}`);
      }
    }

    return { ok: true, objectId };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return { ok: false, error: msg };
  }
}

module.exports = {
  saveToAnytype,
  updateAnytype,
  getAnytypeObject,
  searchAnytype,
  deleteAnytypeObject,
  // Legacy
  publishToAnytype,
};
