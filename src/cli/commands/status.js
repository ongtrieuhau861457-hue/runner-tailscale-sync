/**
 * cli/commands/status.js
 * Show Tailscale status and runner info
 */

const statusCore = require("../../core/status");

async function run(config, logger) {
  logger.info("Checking runner status...");
  return await statusCore.showStatus(config, logger);
}

module.exports = { run };
