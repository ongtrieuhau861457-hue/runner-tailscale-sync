/**
 * cli/commands/init.js
 * Initialize Tailscale and detect previous runner
 */

const initRunner = require("../../core/init");

async function run(config, logger) {
  logger.info("Initializing runner sync...");
  return await initRunner.initRunner(config, logger);
}

module.exports = { run };
