/**
 * Pet auto-start helper — when the honoka launcher boots, make sure the
 * AuraPet daemon is running (processes stay separate; we only spawn it).
 *
 * Configuration:
 *   AURAPET_DIR        mabi checkout; daemon/standalone.js is used
 *   AURAPET_DAEMON_CMD override the executable (args not supported)
 *   HONOKA_NO_PET=1    disable auto-start entirely
 *
 * Probe: TCP connect to the daemon's bridge WS port (127.0.0.1:47821 by
 * default, AURAPET_BRIDGE_PORT overrides). Any listener counts as running.
 */
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_DAEMON_PORT = 47821;

function resolveDaemonCommand(env = process.env) {
  const cmd = typeof env.AURAPET_DAEMON_CMD === "string" ? env.AURAPET_DAEMON_CMD.trim() : "";
  if (cmd) return { command: cmd, args: [] };
  const dir = typeof env.AURAPET_DIR === "string" ? env.AURAPET_DIR.trim() : "";
  if (!dir) return null;
  const entry = path.join(dir, "daemon", "standalone.js");
  if (!fs.existsSync(entry)) return null;
  return { command: process.execPath, args: [entry] };
}

function isDaemonRunning({ port = DEFAULT_DAEMON_PORT, host = "127.0.0.1", timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/**
 * Spawn the daemon when configured and not already running.
 * @returns {Promise<{launched: boolean, reason: string, command?: string, pid?: number}>}
 */
async function maybeLaunchDaemon({
  env = process.env,
  spawnImpl = spawn,
  isRunningImpl = isDaemonRunning,
  log = console,
} = {}) {
  if (env.HONOKA_NO_PET === "1") return { launched: false, reason: "disabled" };
  const port = Number(env.AURAPET_BRIDGE_PORT) || DEFAULT_DAEMON_PORT;
  if (await isRunningImpl({ port })) return { launched: false, reason: "already-running" };
  const resolved = resolveDaemonCommand(env);
  if (!resolved) return { launched: false, reason: "not-configured" };

  try {
    const child = spawnImpl(resolved.command, resolved.args, {
      detached: true,
      stdio: "ignore",
      env: { ...env, AURAPET_DAEMON_SPAWNED_BY: "honoka" },
    });
    child.unref();
    log.info?.(`[launcher] AuraPet daemon started (pid ${child.pid ?? "?"})`);
    return { launched: true, reason: "started", command: resolved.command, pid: child.pid };
  } catch (err) {
    log.warn?.(`[launcher] failed to start AuraPet daemon: ${err.message}`);
    return { launched: false, reason: "spawn-failed" };
  }
}

module.exports = { resolveDaemonCommand, isDaemonRunning, maybeLaunchDaemon, DEFAULT_DAEMON_PORT };