/**
 * core/sync-orchestrator.js
 * Điều phối toàn bộ quy trình sync
 */

const tailscale = require("../adapters/tailscale");
const git = require("../adapters/git");
const fs_adapter = require("../adapters/fs");
const runnerDetector = require("./runner-detector");
const dataSync = require("./data-sync");
const serviceController = require("./service-controller");
const { getTimestamp } = require("../utils/time");
const { ValidationError, ProcessError } = require("../utils/errors");

/**
 * Parse input
 */
function parseInput(config, logger) {
  return {
    config,
    logger,
  };
}

/**
 * Validate
 */
function validate(input) {
  const errors = input.config.validate();
  if (errors.length > 0) {
    throw new ValidationError(`Validation failed:\n  - ${errors.join("\n  - ")}`);
  }
}

/**
 * Plan - xác định các bước cần thực hiện
 */
function plan(input) {
  const { config } = input;

  return {
    steps: [
      { name: "setup_directories", enabled: true },
      { name: "connect_tailscale", enabled: config.tailscaleEnable },
      { name: "detect_previous_runner", enabled: config.tailscaleEnable },
      { name: "pull_data", enabled: config.tailscaleEnable },
      { name: "stop_remote_services", enabled: config.tailscaleEnable },
      { name: "push_to_git", enabled: config.gitEnabled },
    ],
  };
}

async function execute(planResult, input) {
  const { config, logger } = input;
  const results = {};

  for (const step of planResult.steps) {
    if (!step.enabled) {
      logger.debug(`Skipping step: ${step.name}`);
      continue;
    }

    logger.info(`━━━ Step: ${step.name} ━━━`);

    try {
      switch (step.name) {
        case "setup_directories":
          results.setupDirs = await setupDirectories(config, logger);
          break;

        case "connect_tailscale":
          results.tailscale = await connectTailscale(config, logger);
          break;

        case "detect_previous_runner":
          results.detection = await runnerDetector.detectPreviousRunner(config, logger);

          // Set flag for later steps
          const hasPreviousRunner = results.detection?.previousRunner != null;

          if (!hasPreviousRunner) {
            logger.info("No previous runner detected - skipping pull/stop/push");
          }
          break;

        case "pull_data":
          // Check if we have previous runner
          if (!results.detection?.previousRunner) {
            logger.info("Skipping pull - no previous runner");
            results.pullData = { success: true, skipped: true };
            break;
          }

          results.pullData = await dataSync.pullData(config, results.detection.previousRunner, logger);
          break;

        case "stop_remote_services":
          // Check if we have previous runner
          if (!results.detection?.previousRunner) {
            logger.info("Skipping service stop - no previous runner");
            results.stopServices = { success: true, skipped: true };
            break;
          }

          results.stopServices = await serviceController.stopRemoteServices(config, results.detection.previousRunner, logger);
          break;

        case "push_to_git":
          // Check if we have previous runner
          if (!results.detection?.previousRunner) {
            logger.info("Skipping git push - no previous runner");
            results.pushGit = { success: true, skipped: true };
            break;
          }

          results.pushGit = await pushToGit(config, logger);
          break;

        default:
          logger.warn(`Unknown step: ${step.name}`);
      }
    } catch (err) {
      logger.error(`Step failed: ${step.name} - ${err.message}`);
      throw err;
    }
  }

  return results;
}

/**
 * Report
 */
function report(results, input) {
  const { logger } = input;

  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.success("Sync orchestration completed!");

  if (results.tailscale) {
    logger.info(`Tailscale IP: ${results.tailscale.ip || "N/A"}`);
    logger.info(`Tailscale Hostname: ${results.tailscale.hostname || "N/A"}`);
  }

  if (results.detection?.previousRunner) {
    logger.info(`Previous runner: ${results.detection.previousRunner.hostname}`);
  }

  if (results.pullData?.syncedSize) {
    logger.info(`Synced data: ${fs_adapter.formatBytes(results.pullData.syncedSize)}`);
  }

  if (results.stopServices?.stoppedServices?.length > 0) {
    logger.info(`Stopped services: ${results.stopServices.stoppedServices.join(", ")}`);
  }

  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return {
    success: true,
    results,
  };
}

/**
 * Setup directories
 */
async function setupDirectories(config, logger) {
  logger.info("Setting up directories...");

  const dirs = config.getDirectoriesToEnsure();
  fs_adapter.ensureDirs(dirs);

  logger.success(`Created ${dirs.length} directories`);

  return {
    success: true,
    directories: dirs,
  };
}

/**
 * Connect to Tailscale
 */
async function connectTailscale(config, logger) {
  logger.info("Connecting to Tailscale network...");

  // Install if needed
  const installed = tailscale.install(logger);
  if (!installed) {
    throw new ProcessError("Failed to install Tailscale");
  }

  // Login
  await tailscale.login(config.tailscaleClientId, config.tailscaleClientSecret, config.tailscaleTags, logger, config);

  // Get connection info
  const ip = tailscale.getIP(logger);
  const hostname = tailscale.getHostname(logger);

  logger.success(`Connected to Tailscale: ${ip || hostname}`);

  return {
    success: true,
    ip,
    hostname,
  };
}

/**
 * Push to git
 */
async function pushToGit(config, logger) {
  logger.info("Pushing data to git repository...");

  if (!git.isAvailable()) {
    logger.warn("Git not available - skipping push");
    return { success: false };
  }

  if (!git.isGitRepo(config.cwd)) {
    logger.warn("Not a git repository - skipping push");
    return { success: false };
  }

  const timestamp = getTimestamp();
  const message = `[runner-sync] Update .runner-data at ${timestamp}`;

  const pushed = await git.commitAndPush(message, config.gitBranch, {
    logger,
    cwd: config.cwd,
  });

  if (pushed) {
    logger.success("Pushed to git repository");
    return { success: true };
  } else {
    logger.info("No changes to push");
    return { success: true, noChanges: true };
  }
}

/**
 * Main orchestrate function
 */
async function orchestrate(config, logger) {
  // Step 1: Parse Input
  const input = parseInput(config, logger);

  // Step 2: Validate
  validate(input);

  // Step 3: Plan
  const planResult = plan(input);
  logger.debug(`Planned ${planResult.steps.filter((s) => s.enabled).length} steps`);

  // Step 4: Execute
  const execResult = await execute(planResult, input);

  // Step 5: Report
  return report(execResult, input);
}

module.exports = {
  orchestrate,
  parseInput,
  validate,
  plan,
  execute,
  report,
};
