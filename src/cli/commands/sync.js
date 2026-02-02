/**
 * cli/commands/sync.js
 * Full synchronization workflow
 */

const syncOrchestrator = require("../../core/sync-orchestrator");
const { SyncError } = require("../../utils/errors");

async function run(config, logger) {
  logger.info("Starting full synchronization...");

  const result = await syncOrchestrator.orchestrate(config, logger);

  if (result.success) {
    logger.success("Synchronization completed successfully!");
    return result;
  } else {
    throw new SyncError("Synchronization failed");
  }
}

module.exports = { run };
