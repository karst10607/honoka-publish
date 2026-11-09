/**
 * Shared state-file tests — atomic writes and the cross-process lock under
 * real contention (4 child processes × 25 read-modify-write increments).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { readJson, writeJsonAtomic, withFileLock, updateJson } = require("../src/lib/state-file");

const execFileP = promisify(execFile);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-state-test-"));
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("readJson returns the fallback for missing or corrupt files", () => {
  const missing = path.join(TMP, "missing.json");
  assert.deepEqual(readJson(missing, { a: 1 }), { a: 1 });
  const corrupt = path.join(TMP, "corrupt.json");
  fs.writeFileSync(corrupt, "{not json");
  assert.deepEqual(readJson(corrupt), {});
});

test("writeJsonAtomic writes valid JSON with no temp files left behind", () => {
  const file = path.join(TMP, "atomic.json");
  writeJsonAtomic(file, { hello: "world" });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { hello: "world" });
  const leftovers = fs.readdirSync(TMP).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
});

test("withFileLock serializes concurrent updates in one process", async () => {
  const file = path.join(TMP, "serialized.json");
  const order = [];
  await Promise.all([1, 2, 3].map((n) => withFileLock(file, async () => {
    order.push(`start-${n}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push(`end-${n}`);
  })));
  assert.equal(order.length, 6);
  for (let i = 0; i < order.length; i += 2) {
    const n = order[i].match(/^start-(\d)$/)[1];
    assert.equal(order[i + 1], `end-${n}`, `lock released between start/end: ${order.join(",")}`);
  }
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test("4 processes × 25 locked increments lose no updates", async () => {
  const file = path.join(TMP, "counter.json");
  const helper = path.join(__dirname, "..", "src", "lib", "state-file.js");
  const script = `
    const { updateJson } = require(process.env.HONOKA_STATE_HELPER);
    (async () => {
      for (let i = 0; i < 25; i++) {
        await updateJson(process.env.HONOKA_STATE_FILE, (state) => {
          state.count = (state.count || 0) + 1;
        });
      }
    })().catch((err) => { console.error(err.message); process.exit(1); });
  `;
  await Promise.all(Array.from({ length: 4 }, () => execFileP(process.execPath, ["-e", script], {
    env: { ...process.env, HONOKA_STATE_HELPER: helper, HONOKA_STATE_FILE: file },
  })));
  assert.equal(readJson(file).count, 100);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test("stale locks are broken instead of blocking forever", async () => {
  const file = path.join(TMP, "stale.json");
  const lockPath = `${file}.lock`;
  fs.writeFileSync(lockPath, "999999");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);
  const result = await updateJson(file, (state) => { state.ok = true; }, { timeoutMs: 1000 });
  assert.deepEqual(result, { ok: true });
  assert.equal(fs.existsSync(lockPath), false);
});