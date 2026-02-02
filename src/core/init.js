/**
 * core/init.js
 * Initialize Tailscale and detect previous runner
 */

const tailscale = require("../adapters/tailscale");
const fs_adapter = require("../adapters/fs");
const runnerDetector = require("./runner-detector");
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
 * Plan
 */
function plan(input) {
  const { config } = input;

  return {
    steps: [
      { name: "setup_directories", enabled: true },
      { name: "connect_tailscale", enabled: config.tailscaleEnable },
      { name: "detect_previous_runner", enabled: config.tailscaleEnable },
    ],
  };
}

/**
 * Execute
 */
async function execute(planResult, input) {
  const { config, logger } = input;
  const results = {};

  for (const step of planResult.steps) {
    if (!step.enabled) {
      logger.debug(`Skipping step: ${step.name}`);
      continue;
    }

    logger.info(`━━━ Step: ${step.name} ━━━`);

    switch (step.name) {
      case "setup_directories": {
        const dirs = config.getDirectoriesToEnsure();
        fs_adapter.ensureDirs(dirs);
        logger.success(`Created ${dirs.length} directories`);
        results.setupDirs = dirs;
        break;
      }
      case "connect_tailscale": {
        const installed = tailscale.install(logger);
        if (!installed) {
          throw new ProcessError("Failed to install Tailscale");
        }

        await tailscale.login(
          config.tailscaleClientId,
          config.tailscaleClientSecret,
          config.tailscaleTags,
          logger,
          config
        );

        const ip = tailscale.getIP(logger);
        const hostname = tailscale.getHostname(logger);
        logger.success(`Tailscale connected: ${ip || hostname}`);
        results.tailscale = { ip, hostname };
        break;
      }
      case "detect_previous_runner": {
        results.detection = await runnerDetector.detectPreviousRunner(config, logger);
        if (results.detection.previousRunner) {
          logger.success(`Previous runner: ${results.detection.previousRunner.hostname}`);
          logger.info(`  IP: ${results.detection.previousRunner.ips[0]}`);
        } else {
          logger.info("No previous runner found - this is the first runner");
        }
        break;
      }
      default:
        logger.warn(`Unknown step: ${step.name}`);
    }
  }

  return results;
}

/**
 * Report
 */
function report(results, input) {
  const { logger } = input;
  if (!input.config.tailscaleEnable) {
    logger.info("Tailscale disabled - skipping network setup");
  }
  logger.success("Init workflow completed");
  return {
    success: true,
    tailscale: results.tailscale,
    previousRunner: results.detection?.previousRunner || null,
  };
}

/**
 * Main init function
 */
async function initRunner(config, logger) {
  const input = parseInput(config, logger);
  validate(input);
  const planResult = plan(input);
  const execResult = await execute(planResult, input);
  return report(execResult, input);
}

module.exports = {
  initRunner,
  parseInput,
  validate,
  plan,
  execute,
  report,
};
