/**
 * License gating — controls access to Pro features.
 *
 * Free features:
 *   - Single directory sync
 *   - File watcher
 *   - Notion sync (create/update pages)
 *   - Image upload
 *
 * Pro features ($9/mo license key):
 *   - Recursive (nested) directory sync
 *   - Multi-directory watching
 *   - Git integration (auto-commit after sync)
 *   - Multi-platform sync (Notion + Git + more)
 *
 * License key validation is intentionally simple:
 * a signed token checked against a public key or offline validation.
 * For v0.1, we use a file-based check with env override.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const LICENSE_FILE = ".honoka-license";

/**
 * Determine the license level.
 *
 * Checks (in order):
 *   1. HONOKA_LICENSE env var
 *   2. .honoka-license file in CWD or home directory
 *   3. Defaults to "free"
 *
 * @param {object} opts
 * @param {boolean} [opts.explicitPro] - User passed --pro flag
 * @returns {"free"|"pro"}
 */
function getLicenseLevel(opts = {}) {
  // 1. Env var override
  const envKey = process.env.HONOKA_LICENSE;
  if (envKey) {
    if (validateKey(envKey)) return "pro";
    if (opts.explicitPro) console.warn("⚠  HONOKA_LICENSE key is invalid.");
  }

  // 2. Check .honoka-license file
  const candidates = [
    path.join(process.cwd(), LICENSE_FILE),
    path.join(os.homedir(), LICENSE_FILE),
  ];

  for (const file of candidates) {
    try {
      const key = fs.readFileSync(file, "utf8").trim();
      if (validateKey(key)) return "pro";
    } catch { /* file not found */ }
  }

  return "free";
}

/**
 * Validate a license key.
 *
 * For v0.1: simple format check (starts with "pro_" and >= 16 chars).
 * In production, this would verify a JWT or HMAC signature.
 * The key generation would be done server-side and distributed
 * via a simple payment portal (Lemon Squeezy / Gumroad).
 */
function validateKey(key) {
  if (!key || typeof key !== "string") return false;
  if (!key.startsWith("pro_")) return false;
  if (key.length < 16) return false;
  // In production, verify cryptographic signature here
  return true;
}

module.exports = { getLicenseLevel, validateKey };
