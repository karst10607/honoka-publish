#!/usr/bin/env node
/**
 * honoka-launch — start the bridge and make sure the AuraPet daemon is up.
 * The pet is spawned detached (separate process tree); honoka never imports it.
 *
 *   AURAPET_DIR=~/mabi honoka-launch
 *   HONOKA_NO_PET=1 honoka-launch   # bridge only
 */
const { runBridge } = require("../src/bridge");
const { maybeLaunchDaemon } = require("../src/launcher");

const port = Number(process.env.HONOKA_BRIDGE_PORT) || undefined;

runBridge(port);

maybeLaunchDaemon().then((result) => {
  if (result.launched) {
    console.error(`[honoka-launch] AuraPet daemon started (pid ${result.pid ?? "?"})`);
  } else {
    console.error(`[honoka-launch] AuraPet daemon not started: ${result.reason}`);
  }
}).catch((err) => {
  console.error(`[honoka-launch] daemon auto-start failed: ${err.message}`);
});