/**
 * Registry — persistent state tracking for incremental sync.
 *
 * Maintains a JSON file (.honoka/registry.json) inside the target directory
 * so that re-running the tool only syncs new or changed files.
 */
const fs = require("fs");
const path = require("path");

const CONFIG_DIR = ".honoka";
const REGISTRY_FILE = "registry.json";
const CONFIG_FILE = "config.json";

/**
 * Get the .honoka directory path within a target directory.
 */
function configDir(targetDir) {
  return path.join(targetDir, CONFIG_DIR);
}

/**
 * Read the registry from disk.
 * @param {string} targetDir - The directory being synced
 * @returns {object} - Map of relative file path → { hash, pageId, lastSync }
 */
function readRegistry(targetDir) {
  const file = path.join(configDir(targetDir), REGISTRY_FILE);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Write the registry to disk.
 */
function writeRegistry(targetDir, data) {
  const dir = configDir(targetDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, REGISTRY_FILE), JSON.stringify(data, null, 2));
}

/**
 * Compute a simple content hash for change detection.
 * Uses first 16 chars of a hex digest from the file content.
 * @param {string} filePath
 * @returns {string}
 */
function computeHash(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  // Simple hash: a fast non-crypto digest suitable for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Initialize .honoka config in a directory (--init).
 * Creates a config.json that the user can edit.
 */
function initConfig(targetDir) {
  const dir = configDir(targetDir);
  fs.mkdirSync(dir, { recursive: true });

  const configPath = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    const defaults = {
      notionDatabase: process.env.NOTION_DATABASE || "",
      watch: false,
    };
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    console.log(`Created ${configPath}`);
    console.log("Edit this file to set your Notion database ID.");
  } else {
    console.log(`${configPath} already exists.`);
  }

  // Also create .gitkeep for registry
  const regFile = path.join(dir, REGISTRY_FILE);
  if (!fs.existsSync(regFile)) {
    writeRegistry(targetDir, {});
  }
}

/**
 * Read optional .honoka config.
 */
function readConfig(targetDir) {
  const file = path.join(configDir(targetDir), CONFIG_FILE);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

module.exports = {
  readRegistry,
  writeRegistry,
  computeHash,
  initConfig,
  readConfig,
  configDir,
};
