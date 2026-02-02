/**
 * core/data-sync.js
 * Pull/Push .runner-data directory giữa các runners
 */

const path = require("path");
const fs_adapter = require("../adapters/fs");
const process_adapter = require("../adapters/process");
const { SyncError } = require("../utils/errors");
const CONST = require("../utils/constants");

/**
 * Parse input
 */
function parseInput(config, previousRunner, logger) {
  return {
    localDataDir: config.runnerDataDir,
    remoteHost: previousRunner?.dnsName || previousRunner?.ips?.[0],
    remoteDataDir: config.runnerDataDir,
    rsyncPath: config.rsyncPath,
    sshPath: config.sshPath,
    logger,
  };
}

/**
 * Validate
 */
function validate(input) {
  const errors = [];

  if (!input.localDataDir) {
    errors.push("Local data directory is required");
  }

  if (!input.remoteHost) {
    errors.push("Remote host is required");
  }

  return errors;
}

/**
 * Plan
 */
function plan(input) {
  return {
    action: "rsync_pull",
    source: `${input.remoteHost}:${input.remoteDataDir}/`,
    destination: input.localDataDir,
    rsyncPath: input.rsyncPath,
    sshPath: input.sshPath,
  };
}

/**
 * Execute - pull data từ remote runner
 */
async function execute(planResult, input) {
  const { logger } = input;

  logger.info(`Syncing data from ${planResult.source}...`);

  // Ensure local directory exists
  fs_adapter.ensureDir(planResult.destination);

  // Build rsync command
  // rsync -avz -e ssh remote:.runner-data/ local/.runner-data/
  const isLocalNetwork = input.remoteHost?.startsWith("100.");
  const rsyncCmd = [
    planResult.rsyncPath,
    isLocalNetwork ? "-av" : "-avz",
    "--delete",
    "--partial",
    "--progress",
    "-e",
    `${planResult.sshPath} -o StrictHostKeyChecking=no`,
    planResult.source,
    planResult.destination,
  ];

  try {
    await process_adapter.runWithTimeout(
      rsyncCmd,
      CONST.RSYNC_TIMEOUT,
      { logger }
    );

    logger.success("Data synced successfully");

    // Get synced size
    const size = fs_adapter.getDirSize(planResult.destination);
    logger.info(`Synced size: ${fs_adapter.formatBytes(size)}`);

    return {
      success: true,
      size,
    };
  } catch (err) {
    // If rsync not available, try scp as fallback
    logger.warn("Rsync failed, trying scp as fallback...");

    try {
      const scpCmd = `${planResult.sshPath} -r ${planResult.source} ${planResult.destination}`;
      await process_adapter.runWithTimeout(
        scpCmd,
        CONST.RSYNC_TIMEOUT,
        { logger }
      );

      logger.success("Data synced via scp");
      const size = fs_adapter.getDirSize(planResult.destination);
      return {
        success: true,
        size,
      };
    } catch (scpErr) {
      throw new SyncError(`Failed to sync data: ${scpErr.message}`);
    }
  }
}

/**
 * Report
 */
function report(result, input) {
  const { logger } = input;

  if (result.success) {
    logger.success("Data synchronization completed");
    return {
      success: true,
      syncedSize: result.size,
    };
  } else {
    logger.error("Data synchronization failed");
    return {
      success: false,
    };
  }
}

/**
 * Main pull function
 */
async function pullData(config, previousRunner, logger) {
  if (!previousRunner) {
    logger.info("No previous runner - skipping data pull");
    return { success: true, syncedSize: 0 };
  }

  // Step 1: Parse Input
  const input = parseInput(config, previousRunner, logger);

  // Step 2: Validate
  const errors = validate(input);
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(", ")}`);
  }

  // Step 3: Plan
  const planResult = plan(input);

  // Step 4: Execute
  const execResult = await execute(planResult, input);

  // Step 5: Report
  return report(execResult, input);
}

module.exports = {
  pullData,
  parseInput,
  validate,
  plan,
  execute,
  report,
};
