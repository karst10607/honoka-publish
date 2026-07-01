/**
 * File watcher — monitors a directory for changes and triggers sync.
 *
 * Uses fs.watch (native) for cross-platform file change notifications.
 * Includes debouncing to avoid duplicate triggers on save.
 */
const fs = require("fs");
const path = require("path");
const { syncDirectory } = require("./sync");

const DEBOUNCE_MS = 500;

/**
 * Start watching a directory for changes.
 * When a .md file is added or modified, triggers a sync.
 *
 * @param {string} targetDir
 * @param {object} opts - Same as syncDirectory opts
 * @returns {Promise<void>} - Never resolves (runs until SIGINT)
 */
async function startWatcher(targetDir, opts) {
  // Do an initial sync
  const initial = await syncDirectory(targetDir, opts);
  console.log(`Initial sync: ${initial.synced} synced, ${initial.skipped} skipped\n`);

  // Debounce map: relativePath → timer
  const timers = new Map();

  const onChange = (eventType, filename) => {
    if (!filename || !filename.endsWith(".md")) return;

    const relativePath = filename;
    const absolutePath = path.join(targetDir, relativePath);

    // Skip files in .honoka directory
    if (relativePath.startsWith(".honoka")) return;

    // Check file still exists (debounce may fire after delete)
    if (!fs.existsSync(absolutePath)) return;

    // Debounce
    if (timers.has(relativePath)) {
      clearTimeout(timers.get(relativePath));
    }

    timers.set(relativePath, setTimeout(async () => {
      timers.delete(relativePath);
      console.log(`\n📝 Change detected: ${relativePath}`);
      try {
        const result = await syncDirectory(targetDir, opts);
        console.log(`Synced: ${result.synced} updated, ${result.skipped} skipped`);
      } catch (err) {
        console.error(`Sync error: ${err.message}`);
      }
    }, DEBOUNCE_MS));
  };

  try {
    const watcher = fs.watch(targetDir, { recursive: true }, onChange);
    console.log("Watcher ready. Press Ctrl+C to stop.");

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\nShutting down watcher...");
      watcher.close();
      process.exit(0);
    });

    // Keep alive
    await new Promise(() => {});
  } catch (err) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      console.error("Permission denied. Try running with --watch on a single directory.");
    }
    throw err;
  }
}

module.exports = { startWatcher };
