/**
 * adapters/process.js
 * Cross-platform process spawning
 */

const { execSync, spawn } = require("child_process");
const os = require("os");

const isWindows = os.platform() === "win32";

/**
 * Run command và wait for completion
 */
function run(cmd, options = {}) {
  const { ignoreError = false, cwd, logger } = options;

  if (logger) {
    logger.command(cmd);
  }

  try {
    return execSync(cmd, {
      stdio: "inherit",
      cwd: cwd || process.cwd(),
      ...options,
    });
  } catch (err) {
    if (ignoreError) {
      if (logger) {
        logger.warn(`Command failed (ignored): ${cmd}`);
      }
      return null;
    }
    throw err;
  }
}

/**
 * Run command và capture output
 */
function runCapture(cmd, options = {}) {
  const { cwd } = options;

  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      cwd: cwd || process.cwd(),
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if command exists
 */
function commandExists(cmd) {
  const check = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
  return !!runCapture(check);
}

/**
 * Run command with timeout
 */
function runWithTimeout(cmd, timeoutMs, options = {}) {
  const { logger } = options;

  // Support both string commands and argv arrays.
  // - If cmd is an array: [exe, ...args] -> spawn(exe, args)
  // - If cmd is a string: spawn(cmd, { shell: true }) so quoting works cross-platform
  const useArray = Array.isArray(cmd);

  return new Promise((resolve, reject) => {
    const spawnOptions = {
      stdio: "inherit",
      cwd: options.cwd || process.cwd(),
      detached: !isWindows,
    };
    const child = useArray
      ? spawn(cmd[0], cmd.slice(1), spawnOptions)
      : spawn(cmd, { ...spawnOptions, shell: true });

    const timer = setTimeout(() => {
      if (isWindows) {
        try {
          execSync(`taskkill /pid ${child.pid} /T /F`);
        } catch (err) {
          if (logger) {
            logger.warn(`Failed to terminate process tree: ${err.message}`);
          }
        }
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (err) {
          if (logger) {
            logger.warn(`Failed to terminate process group: ${err.message}`);
          }
        }
      }
      reject(new Error(`Command timeout after ${timeoutMs}ms: ${useArray ? cmd.join(" ") : cmd}`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`Command failed with code ${code}: ${useArray ? cmd.join(" ") : cmd}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}


/**
 * Sleep
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for condition
 */
async function waitForCondition(checkFn, timeoutMs = 30000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (checkFn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

module.exports = {
  run,
  runCapture,
  commandExists,
  runWithTimeout,
  sleep,
  waitForCondition,
  isWindows,
};
