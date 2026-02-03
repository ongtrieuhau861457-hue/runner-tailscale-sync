/**
 * core/data-sync.js
 * Pull/Push .runner-data directory giữa các runners
 */

const path = require("path");
const fs_adapter = require("../adapters/fs");
const process_adapter = require("../adapters/process");
const { SyncError, ValidationError } = require("../utils/errors");
const CONST = require("../utils/constants");

/**
 * Resolve host to include user if not present
 * @param {string} host - hostname or IP, optionally with user (user@host)
 * @returns {string} - host with user prefix (root@host if no user specified)
 */
function resolveHost(host) {
  if (!host) {
    return host;
  }

  // Nếu đã có @ (đã có user) thì giữ nguyên
  if (host.includes("@")) {
    return host;
  }

  // Nếu chưa có @ thì thêm root@
  return `root@${host}`;
}

/**
 * Parse input
 */
function parseInput(config, previousRunner, logger) {
  const remoteHostRaw = previousRunner?.dnsName || previousRunner?.ips?.[0];
  const remoteHost = resolveHost(remoteHostRaw);

  return {
    localDataDir: config.runnerDataDir,
    remoteHost: remoteHost,
    remoteHostRaw: remoteHostRaw, // Lưu lại để check isLocalNetwork
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

  if (errors.length > 0) {
    throw new ValidationError(`Validation failed: ${errors.join(", ")}`);
  }
}

/**
 * Plan
 */
function plan(input) {
  return {
    action: "rsync_pull",
    source: `${input.remoteHost}:${input.remoteDataDir}/`,
    destination: input.localDataDir,
    remoteHost: input.remoteHost,
    remoteHostRaw: input.remoteHostRaw,
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
  // rsync -avz -e "ssh -o StrictHostKeyChecking=no" root@remote:.runner-data/ local/.runner-data/
  const isLocalNetwork = planResult.remoteHostRaw?.startsWith("100.");
  const rsyncCmd = [
    planResult.rsyncPath,
    isLocalNetwork ? "-av" : "-avz",
    "--delete",
    "--partial",
    "--progress",
    "-e",
    `${planResult.sshPath} -o StrictHostKeyChecking=no -o LogLevel=ERROR`,
    planResult.source,
    planResult.destination,
  ];

  try {
    await process_adapter.runWithTimeout(rsyncCmd, CONST.RSYNC_TIMEOUT, { logger });

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
      // scp -r -o StrictHostKeyChecking=no root@remote:.runner-data/* local/.runner-data/
      const scpCmd = [
        planResult.sshPath.replace("ssh", "scp"), // Thay ssh bằng scp
        "-r",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "LogLevel=ERROR",
        `${planResult.remoteHost}:${planResult.source.replace(/\/$/, "")}/*`, // Remove trailing slash
        planResult.destination,
      ];

      await process_adapter.runWithTimeout(scpCmd, CONST.RSYNC_TIMEOUT, { logger });

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
  validate(input);

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
  resolveHost,
};
