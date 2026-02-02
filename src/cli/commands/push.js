/**
 * cli/commands/push.js
 * Push .runner-data to git repository
 */

const pushRunner = require("../../core/push");

async function run(config, logger) {
  logger.info("Pushing .runner-data to git...");
  return await pushRunner.pushRunnerData(config, logger);
}

module.exports = { run };
