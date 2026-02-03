/**
 * adapters/ssh.js
 * SSH operations: execute commands remotely
 */

const process_adapter = require("./process");
const { ProcessError } = require("../utils/errors");
const CONST = require("../utils/constants");

/**
 * Execute command via SSH
 */
function executeCommand(host, command, options = {}) {
  const { logger, sshPath = "ssh", timeout = CONST.SSH_TIMEOUT } = options;

  // If sshPath contains spaces, spawn can still execute it if provided as argv[0].
  // Avoid building a single shell string to keep quoting predictable.
  const sshArgs = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", host, command];

  if (logger) {
    logger.info([sshPath, ...sshArgs].join(" "));
  }

  return process_adapter.runWithTimeout([sshPath, ...sshArgs], timeout, { logger });
}

/**
 * Execute command với fallback sudo nếu thất bại
 */
async function executeCommandWithSudoFallback(host, command, options = {}) {
  const { logger, sshPath = "ssh", timeout = CONST.SSH_TIMEOUT } = options;

  try {
    // Thử lệnh thường trước
    return await executeCommand(host, command, { logger, sshPath, timeout });
  } catch (err) {
    // Nếu lỗi và chưa có sudo, thử lại với sudo
    if (!command.trim().startsWith("sudo")) {
      if (logger) {
        logger.debug(`Command failed, retrying with sudo: ${command}`);
      }
      try {
        return await executeCommand(host, `sudo ${command}`, { logger, sshPath, timeout });
      } catch (sudoErr) {
        // Throw lỗi sudo nếu cả 2 đều fail
        throw sudoErr;
      }
    }
    // Nếu đã có sudo rồi mà vẫn lỗi thì throw
    throw err;
  }
}

/**
 * Execute command và capture output
 */
function executeCommandCapture(host, command, options = {}) {
  const { sshPath = "ssh" } = options;

  const sshCmd = `${sshPath} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${host} "${command}"`;

  try {
    return process_adapter.runCapture(sshCmd);
  } catch (err) {
    return null;
  }
}

/**
 * Check if SSH connection works
 */
function checkConnection(host, options = {}) {
  const { logger, sshPath = "ssh" } = options;

  if (logger) {
    logger.debug(`Testing SSH connection to ${host}...`);
  }

  try {
    const result = executeCommandCapture(host, "echo OK", { sshPath });
    return result === "OK";
  } catch {
    return false;
  }
}

/**
 * Stop services on remote host
 */
async function stopServices(host, services, options = {}) {
  const { logger, sshPath = "ssh" } = options;

  if (!services || services.length === 0) {
    if (logger) {
      logger.info("No services to stop");
    }
    return;
  }

  logger.info(`Stopping services on ${host}: ${services.join(", ")}`);

  await Promise.all(
    services.map(async (service) => {
      try {
        // Thử systemctl stop với sudo fallback
        await executeCommandWithSudoFallback(host, `systemctl stop ${service}`, {
          logger,
          sshPath,
        });
        logger.success(`Stopped service: ${service}`);
      } catch (err) {
        try {
          // Nếu systemctl fail, thử pkill với sudo fallback
          await executeCommandWithSudoFallback(host, `pkill -f ${service}`, {
            logger,
            sshPath,
          });
          logger.success(`Killed process: ${service}`);
        } catch (err2) {
          logger.warn(`Failed to stop ${service}: ${err2.message}`);
        }
      }
    }),
  );
}

module.exports = {
  executeCommand,
  executeCommandWithSudoFallback,
  executeCommandCapture,
  checkConnection,
  stopServices,
};
