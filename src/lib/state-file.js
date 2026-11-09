/**
 * Shared JSON state helpers for files touched by multiple honoka processes
 * (MCP clients, bridge, CLI): atomic writes (tmp + rename) and an advisory
 * cross-process lock for read-modify-write sequences.
 */
const fs = require("fs");
const path = require("path");

const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock(file, fn, { timeoutMs = LOCK_TIMEOUT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const lockPath = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = Date.now();
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for lock: ${lockPath}`);
      await sleep(10 + Math.random() * 20);
      continue;
    }
    try {
      fs.writeSync(fd, String(process.pid));
      return await fn();
    } finally {
      try { fs.closeSync(fd); } catch { /* closed */ }
      fs.rmSync(lockPath, { force: true });
    }
  }
}

/** Locked read-modify-write. `mutate` may return a replacement object. */
async function updateJson(file, mutate, opts) {
  return withFileLock(file, () => {
    const current = readJson(file, {});
    const result = mutate(current);
    const next = result === undefined ? current : result;
    writeJsonAtomic(file, next);
    return next;
  }, opts);
}

module.exports = { readJson, writeJsonAtomic, withFileLock, updateJson };