/**
 * adapters/git.js
 * Git operations: push, pull, conflict resolution
 */

const process_adapter = require("./process");
const { ProcessError } = require("../utils/errors");
const CONST = require("../utils/constants");

/**
 * Check if git is available
 */
function isAvailable() {
  return process_adapter.commandExists("git");
}

/**
 * Check if current directory is a git repo
 */
function isGitRepo(cwd) {
  try {
    const output = process_adapter.runCapture("git rev-parse --git-dir", { cwd });
    return output !== null;
  } catch {
    return false;
  }
}

/**
 * Add files to git
 */
function add(files, options = {}) {
  const { logger, cwd } = options;

  const filesStr = Array.isArray(files) ? files.join(" ") : files;
  const cmd = `git add ${filesStr}`;

  try {
    process_adapter.run(cmd, { logger, cwd, ignoreError: false });
    return true;
  } catch (err) {
    throw new ProcessError(`Git add failed: ${err.message}`);
  }
}

/**
 * Commit changes
 */
function commit(message, options = {}) {
  const { logger, cwd } = options;

  const safeMessage = message.replace(/"/g, '\\"');
  const cmd = `git commit -m "${safeMessage}"`;

  try {
    process_adapter.run(cmd, { logger, cwd, ignoreError: false });
    return true;
  } catch (err) {
    // No changes to commit is OK
    if (err.message && err.message.includes("nothing to commit")) {
      if (logger) {
        logger.debug("No changes to commit");
      }
      return false;
    }
    throw new ProcessError(`Git commit failed: ${err.message}`);
  }
}

/**
 * Push to remote
 */
async function push(branch, options = {}) {
  const { logger, cwd, retries = CONST.GIT_RETRY_COUNT } = options;

  const cmd = `git push origin ${branch}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      process_adapter.run(cmd, { logger, cwd, ignoreError: false });
      if (logger) {
        logger.success(`Pushed to ${branch}`);
      }
      return true;
    } catch (err) {
      if (attempt < retries) {
        if (logger) {
          logger.warn(`Push failed (attempt ${attempt}/${retries}), retrying...`);
        }
        await process_adapter.sleep(CONST.GIT_RETRY_DELAY);
      } else {
        throw new ProcessError(`Git push failed after ${retries} attempts: ${err.message}`);
      }
    }
  }
}

/**
 * Pull from remote
 */
async function pull(branch, options = {}) {
  const { logger, cwd, retries = CONST.GIT_RETRY_COUNT } = options;

  const cmd = `git pull origin ${branch}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      process_adapter.run(cmd, { logger, cwd, ignoreError: false });
      if (logger) {
        logger.success(`Pulled from ${branch}`);
      }
      return true;
    } catch (err) {
      if (attempt < retries) {
        if (logger) {
          logger.warn(`Pull failed (attempt ${attempt}/${retries}), retrying...`);
        }
        await process_adapter.sleep(CONST.GIT_RETRY_DELAY);
      } else {
        throw new ProcessError(`Git pull failed after ${retries} attempts: ${err.message}`);
      }
    }
  }
}

/**
 * Get current branch
 */
function getCurrentBranch(cwd) {
  try {
    return process_adapter.runCapture("git rev-parse --abbrev-ref HEAD", { cwd });
  } catch {
    return null;
  }
}

/**
 * Check if there are uncommitted changes
 */
function hasUncommittedChanges(cwd) {
  try {
    const output = process_adapter.runCapture("git status --porcelain", { cwd });
    return output && output.length > 0;
  } catch {
    return false;
  }
}

/**
 * Full workflow: add, commit, push
 */
async function commitAndPush(message, branch, options = {}) {
  const { logger, cwd } = options;

  if (!hasUncommittedChanges(cwd)) {
    if (logger) {
      logger.info("No changes to commit");
    }
    return false;
  }

  // Ensure git identity is configured
  ensureIdentity(cwd, { logger });

  // Add all changes in .runner-data
  // Tạo file .gitkeep trong thư mục .runner-data
  fs.writeFileSync(".runner-data/.gitkeep", new Date().toISOString());
  add(".runner-data", { logger, cwd });

  // Commit
  const committed = commit(message, { logger, cwd });
  if (!committed) return false;

  // Push
  await push(branch, { logger, cwd });

  return true;
}

/**
 * Ensure git identity is configured
 */
function ensureIdentity(cwd, options = {}) {
  const { logger } = options;

  try {
    // Check if identity exists
    const name = process_adapter.runCapture("git config user.name", { cwd });
    const email = process_adapter.runCapture("git config user.email", { cwd });

    if (!name || !email) {
      // Set default identity for automation
      process_adapter.run('git config user.name "Automation Bot"', { cwd });
      process_adapter.run('git config user.email "bot@automation.local"', { cwd });

      if (logger) {
        logger.info("Git identity configured for automation");
      }
    }
  } catch (err) {
    // Set identity if check failed
    try {
      process_adapter.run('git config user.name "Automation Bot"', { cwd });
      process_adapter.run('git config user.email "bot@automation.local"', { cwd });
    } catch (configErr) {
      if (logger) {
        logger.warn("Could not configure git identity");
      }
    }
  }
}

module.exports = {
  isAvailable,
  isGitRepo,
  add,
  commit,
  push,
  pull,
  getCurrentBranch,
  hasUncommittedChanges,
  commitAndPush,
};
