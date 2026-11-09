/**
 * Launcher tests — resolve/probe/spawn logic with injected side effects
 * (no real daemon or GUI process is started).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { resolveDaemonCommand, isDaemonRunning, maybeLaunchDaemon } = require("../src/launcher");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "honoka-launcher-test-"));
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function fakeMabiCheckout(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, "daemon"), { recursive: true });
  fs.writeFileSync(path.join(dir, "daemon", "standalone.js"), "// fake daemon\n");
  return dir;
}

const quietLog = { info() {}, warn() {} };

test("resolveDaemonCommand prefers AURAPET_DAEMON_CMD", () => {
  assert.deepEqual(
    resolveDaemonCommand({ AURAPET_DAEMON_CMD: "/opt/pet/run-pet", AURAPET_DIR: "/x" }),
    { command: "/opt/pet/run-pet", args: [] }
  );
});

test("resolveDaemonCommand resolves AURAPET_DIR/daemon/standalone.js", () => {
  const dir = fakeMabiCheckout("mabi-resolve");
  assert.deepEqual(
    resolveDaemonCommand({ AURAPET_DIR: dir }),
    { command: process.execPath, args: [path.join(dir, "daemon", "standalone.js")] }
  );
});

test("resolveDaemonCommand returns null when unconfigured or entry missing", () => {
  assert.equal(resolveDaemonCommand({}), null);
  assert.equal(resolveDaemonCommand({ AURAPET_DIR: path.join(TMP, "missing") }), null);
});

test("maybeLaunchDaemon skips when disabled, running, or unconfigured", async () => {
  let spawned = 0;
  const spawnImpl = () => { spawned += 1; return { pid: 1, unref() {} }; };
  assert.deepEqual(
    await maybeLaunchDaemon({ env: { HONOKA_NO_PET: "1" }, spawnImpl, isRunningImpl: async () => true, log: quietLog }),
    { launched: false, reason: "disabled" }
  );
  assert.deepEqual(
    await maybeLaunchDaemon({ env: { AURAPET_DIR: fakeMabiCheckout("mabi-running") }, spawnImpl, isRunningImpl: async () => true, log: quietLog }),
    { launched: false, reason: "already-running" }
  );
  assert.deepEqual(
    await maybeLaunchDaemon({ env: {}, spawnImpl, isRunningImpl: async () => false, log: quietLog }),
    { launched: false, reason: "not-configured" }
  );
  assert.equal(spawned, 0);
});

test("maybeLaunchDaemon spawns detached, ignores stdio, and unrefs", async () => {
  const dir = fakeMabiCheckout("mabi-spawn");
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = { pid: 4242, unref() { child.unrefCalled = true; } };
    calls.push({ command, args, options, child });
    return child;
  };
  const result = await maybeLaunchDaemon({
    env: { AURAPET_DIR: dir },
    spawnImpl,
    isRunningImpl: async () => false,
    log: quietLog,
  });
  assert.equal(result.launched, true);
  assert.equal(result.pid, 4242);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [path.join(dir, "daemon", "standalone.js")]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(calls[0].options.env.AURAPET_DAEMON_SPAWNED_BY, "honoka");
  assert.equal(calls[0].child.unrefCalled, true);
});

test("maybeLaunchDaemon reports spawn failures without throwing", async () => {
  const dir = fakeMabiCheckout("mabi-fail");
  const result = await maybeLaunchDaemon({
    env: { AURAPET_DIR: dir },
    spawnImpl: () => { throw new Error("boom"); },
    isRunningImpl: async () => false,
    log: quietLog,
  });
  assert.deepEqual(result, { launched: false, reason: "spawn-failed" });
});

test("isDaemonRunning detects a listener and a closed port", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  assert.equal(await isDaemonRunning({ port }), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isDaemonRunning({ port, timeoutMs: 200 }), false);
});