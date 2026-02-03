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
 * Check if remote directory exists
 *
 * NOTE: Tạm thời không dùng vì có issue với output capture trong một số môi trường.
 * Thay vào đó, để rsync tự handle với --ignore-missing-args flag.
 * Keep function này để reference sau.
 */
/*
async function checkRemoteDir(remoteHost, remoteDir, sshPath, logger) {
  try {
    // Giải pháp 1: Dùng executeCommandCapture từ ssh adapter (nếu có)
    // Nếu không có ssh adapter, dùng cách thủ công
    const ssh = require("../adapters/ssh");
    
    const command = `test -d "${remoteDir}" && echo "MARKER:exists" || echo "MARKER:not_found"`;
    const output = ssh.executeCommandCapture(remoteHost, command, { 
      sshPath, 
      logger,
      silent: true 
    });
    
    logger.debug(`checkRemoteDir ssh output: "${output}"`);
    
    const exists = output && output.includes("MARKER:exists");
    logger.debug(`checkRemoteDir result: exists=${exists}`);
    
    return exists;
  } catch (err) {
    logger.warn(`Could not check remote directory: ${err.message}`);
    return false;
  }
}
*/

/**
 * Parse input
 */
function parseInput(config, previousRunner, logger) {
  const remoteHostRaw = previousRunner?.ips?.[0];

  // Ưu tiên dùng metadata nếu có
  let remoteUser = "root";
  let remoteDataDir = config.runnerDataDir;

  if (previousRunner?.metadata) {
    // Ưu tiên env.USER, fallback sang runner.user, cuối cùng mới dùng "root"
    const metaUser = previousRunner.metadata.runner?.user;
    const envUser = previousRunner.metadata.env?.USER;

    remoteUser = metaUser && metaUser !== "unknown" ? metaUser : envUser || "root";
    remoteDataDir = previousRunner.metadata.runner?.runnerDataDir || config.runnerDataDir;

    logger.debug(`Using metadata: user=${remoteUser}, dataDir=${remoteDataDir}`);
  }

  const remoteHost = remoteHostRaw ? `${remoteUser}@${remoteHostRaw}` : null;

  return {
    localDataDir: config.runnerDataDir,
    remoteHost: remoteHost,
    remoteHostRaw: remoteHostRaw, // Lưu lại để check isLocalNetwork
    remoteDataDir: remoteDataDir,
    remoteUser: remoteUser,
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
    remoteDataDir: input.remoteDataDir,
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

  // APPROACH V2: Skip precheck, rsync sẽ tự báo lỗi nếu dir không tồn tại
  // Lý do: SSH check có vấn đề với output capture trong một số môi trường
  // Rsync đủ thông minh để handle missing source dir

  // Ensure local directory exists
  fs_adapter.ensureDir(planResult.destination);

  // Build rsync command
  const isLocalNetwork = planResult.remoteHostRaw?.startsWith("100.");
  const rsyncCmd = [
    planResult.rsyncPath,
    isLocalNetwork ? "-av" : "-avz",
    "--delete",
    "--partial",
    "--progress",
    "--ignore-missing-args", // 👈 Quan trọng: không fail nếu source không tồn tại
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

    if (size === 0) {
      logger.info("No data was synced (empty or missing source directory)");
      return {
        success: true,
        size: 0,
        skipped: true,
      };
    }

    logger.info(`Synced size: ${fs_adapter.formatBytes(size)}`);

    return {
      success: true,
      size,
    };
  } catch (err) {
    // Check nếu lỗi do source không tồn tại
    if (err.message.includes("No such file") || err.message.includes("does not exist")) {
      logger.warn(`Remote directory does not exist or is empty`);
      logger.info("Skipping data sync - no data to pull");
      return {
        success: true,
        size: 0,
        skipped: true,
      };
    }

    // If rsync not available, try scp as fallback
    logger.warn("Rsync failed, trying scp as fallback...");
    try {
      // scp -r -o StrictHostKeyChecking=no root@remote:/path/to/.runner-data/* /local/path/
      const scpPath = planResult.sshPath.replace(/ssh$/, "scp");
      const remotePath = `${planResult.remoteHost}:${planResult.remoteDataDir}/*`;

      const scpCmd = [scpPath, "-r", "-o", "StrictHostKeyChecking=no", "-o", "LogLevel=ERROR", remotePath, planResult.destination];

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
    if (result.skipped) {
      logger.info("Data synchronization skipped - no remote data");
    } else {
      logger.success("Data synchronization completed");
    }
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
  // checkRemoteDir, // Disabled - see comment in function
};
