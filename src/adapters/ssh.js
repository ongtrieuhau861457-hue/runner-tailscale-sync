/**
 * adapters/ssh.js
 * SSH operations: execute commands remotely
 */

const process_adapter = require("./process");
const { ProcessError } = require("../utils/errors");
const CONST = require("../utils/constants");

/**
 * Resolve host to include user if not present
 * @param {string} host - hostname or IP, optionally with user (user@host)
 * @returns {string} - host with user prefix (root@host if no user specified)
 */
function resolveHost(host) {
  if (!host) {
    throw new Error("Host cannot be empty");
  }

  // Nếu đã có @ (đã có user) thì giữ nguyên
  if (host.includes("@")) {
    return host;
  }

  // Nếu chưa có @ thì thêm root@
  return `root@${host}`;
}

/**
 * Execute command via SSH
 */
function executeCommand(host, command, options = {}) {
  const { logger, sshPath = "ssh", timeout = CONST.SSH_TIMEOUT } = options;

  // Resolve host to include user
  const resolvedHost = resolveHost(host);

  // If sshPath contains spaces, spawn can still execute it if provided as argv[0].
  // Avoid building a single shell string to keep quoting predictable.
  const sshArgs = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", resolvedHost, command];

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

  // Resolve host to include user
  const resolvedHost = resolveHost(host);

  const sshCmd = `${sshPath} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${resolvedHost} "${command}"`;

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
  // Resolve host to include user
  const resolvedHost = resolveHost(host);

  if (logger) {
    logger.debug(`Testing SSH connection to ${resolvedHost}...`);
  }
  const strOK = "OKKK";
  try {
    const result = executeCommandCapture(resolvedHost, "echo " + strOK, { sshPath });
    logger.debug(`Capture checkConnection: ${result}`);
    return (result + "").includes(strOK);
  } catch {
    return false;
  }
}

async function stopServices(host, services, options = {}) {
  const { logger, sshPath = "ssh" } = options;

  if (!services || services.length === 0) {
    if (logger) {
      logger.info("No services to stop");
    }
    return;
  }

  // Resolve host to include user
  const resolvedHost = resolveHost(host);

  logger.info(`Stopping services on ${resolvedHost}: ${services.join(", ")}`);

  // Stop tất cả services song song với &
  const stopCommands = services.map((service) => `(sudo systemctl stop ${service} 2>/dev/null || sudo pkill -f ${service} 2>/dev/null) &`).join(" ");

  try {
    // wait để đợi tất cả background jobs hoàn thành
    const bgCommand = `nohup sh -c 'sleep 1 && ${stopCommands} wait' >/dev/null 2>&1 & disown`;

    await executeCommand(resolvedHost, bgCommand, {
      logger,
      sshPath,
      timeout: 3000,
    });

    logger.success(`Sent parallel stop commands for: ${services.join(", ")}`);

    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (err) {
    if (err.message.includes("Connection") || err.message.includes("timed out")) {
      logger.success(`Stop commands sent for ${services.join(", ")} (connection may be lost)`);
    } else {
      logger.warn(`Failed to stop services: ${err.message}`);
    }
  }
}

module.exports = {
  executeCommand,
  executeCommandWithSudoFallback,
  executeCommandCapture,
  checkConnection,
  stopServices,
  resolveHost, // Export để có thể test hoặc dùng ở nơi khác
};
