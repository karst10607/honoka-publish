/**
 * Anytype integration — sync published documents to Anytype.
 * Clean external addition (no company IP).
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

/**
 * Publish a document to Anytype.
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.body - Markdown content
 * @param {string} [params.url] - Original source URL
 * @param {string} [params.category] - Document category
 * @param {object} [params.properties] - Structured data (price, area, etc.)
 * @param {object} params.config - { apiUrl, apiKey, spaceId, collections }
 * @returns {Promise<{ok: boolean, objectId?: string}>}
 */
async function publishToAnytype({ title, body, url, category, properties, config }) {
  const { apiUrl = DEFAULT_API_URL, apiKey, spaceId } = config;
  if (!apiKey || !spaceId) {
    return { ok: false, error: "Anytype not configured" };
  }

  const typeKey = TYPE_MAP[category] || TYPE_MAP.default;

  try {
    // Create object
    const createResp = await axios.post(
      `${apiUrl}/v1/spaces/${spaceId}/objects`,
      {
        name: title,
        type_key: typeKey,
        body: body || "",
      },
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
    if (!objectId) {
      return { ok: false, error: "No object ID in response" };
    }

    // Add to collection if configured
    const collections = config.collections || {};
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

module.exports = { publishToAnytype };
