/**
 * core/push.js
 * Push .runner-data to git repository
 */

const git = require("../adapters/git");
const { getTimestamp } = require("../utils/time");
const { ValidationError, ProcessError } = require("../utils/errors");

/**
 * Parse input
 */
function parseInput(config, logger) {
  return {
    gitEnabled: config.gitEnabled,
    gitBranch: config.gitBranch,
    cwd: config.cwd,
    logger,
  };
}

/**
 * Validate
 */
function validate(input) {
  if (!input.gitEnabled) {
    return;
  }

  if (!git.isAvailable()) {
    throw new ProcessError("Git is not available");
  }

  if (!git.isGitRepo(input.cwd)) {
    throw new ValidationError("Not a git repository");
  }
}

/**
 * Plan
 */
function plan(input) {
  if (!input.gitEnabled) {
    return { action: "skip" };
  }

  return {
    action: "push_runner_data",
    branch: input.gitBranch,
    cwd: input.cwd,
  };
}

/**
 * Execute
 */
async function execute(planResult, input) {
  const { logger } = input;

  if (planResult.action === "skip") {
    logger.warn("Git push disabled (GIT_PUSH_ENABLED=0)");
    return { skipped: true };
  }

  const timestamp = getTimestamp();
  const message = `[runner-sync] Update .runner-data at ${timestamp}`;

  const pushed = await git.commitAndPush(message, planResult.branch, {
    logger,
    cwd: planResult.cwd,
  });

  return { pushed };
}

/**
 * Report
 */
function report(result, input) {
  const { logger } = input;

  if (result.skipped) {
    return { success: false, skipped: true };
  }

  if (result.pushed) {
    logger.success("Pushed to git repository");
    return { success: true };
  }

  logger.info("No changes to push");
  return { success: true, noChanges: true };
}

/**
 * Main push function
 */
async function pushRunnerData(config, logger) {
  const input = parseInput(config, logger);
  validate(input);
  const planResult = plan(input);
  const execResult = await execute(planResult, input);
  return report(execResult, input);
}

module.exports = {
  pushRunnerData,
  parseInput,
  validate,
  plan,
  execute,
  report,
};
