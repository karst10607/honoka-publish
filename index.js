/**
 * honoka-publish — Programmatic entry point.
 * Exposes core functions for thin-wrapper packages (e.g., honoka-bridge).
 */
const { runBridge } = require("./src/bridge");

module.exports = { runBridge };
