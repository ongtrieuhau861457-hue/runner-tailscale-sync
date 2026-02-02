/**
 * src/index.js
 * Main library export - cho phép import như library
 */

const Config = require("./utils/config");
const Logger = require("./utils/logger");
const syncOrchestrator = require("./core/sync-orchestrator");
const runnerDetector = require("./core/runner-detector");
const dataSync = require("./core/data-sync");
const serviceController = require("./core/service-controller");
const initRunner = require("./core/init");
const pushRunner = require("./core/push");
const statusRunner = require("./core/status");

// Adapters
const tailscale = require("./adapters/tailscale");
const git = require("./adapters/git");
const ssh = require("./adapters/ssh");
const fs_adapter = require("./adapters/fs");
const process_adapter = require("./adapters/process");
const http_adapter = require("./adapters/http");

// Utils
const time = require("./utils/time");
const errors = require("./utils/errors");
const constants = require("./utils/constants");

/**
 * Main API - orchestrate full sync
 */
async function sync(options = {}) {
  const config = new Config(options);
  const pkg = require("../package.json");

  const logger = new Logger({
    packageName: pkg.name,
    version: pkg.version,
    command: "sync",
    verbose: options.verbose || false,
    quiet: options.quiet || false,
  });

  logger.printBanner();

  return await syncOrchestrator.orchestrate(config, logger);
}

/**
 * Init only
 */
async function init(options = {}) {
  const config = new Config(options);
  const pkg = require("../package.json");

  const logger = new Logger({
    packageName: pkg.name,
    version: pkg.version,
    command: "init",
    verbose: options.verbose || false,
    quiet: options.quiet || false,
  });

  logger.printBanner();

  return await initRunner.initRunner(config, logger);
}

/**
 * Push to git only
 */
async function push(options = {}) {
  const config = new Config(options);
  const pkg = require("../package.json");

  const logger = new Logger({
    packageName: pkg.name,
    version: pkg.version,
    command: "push",
    verbose: options.verbose || false,
    quiet: options.quiet || false,
  });

  logger.printBanner();

  return await pushRunner.pushRunnerData(config, logger);
}

/**
 * Show status
 */
async function status(options = {}) {
  const config = new Config(options);
  const pkg = require("../package.json");

  const logger = new Logger({
    packageName: pkg.name,
    version: pkg.version,
    command: "status",
    verbose: options.verbose || false,
    quiet: options.quiet || false,
  });

  logger.printBanner();

  return await statusRunner.showStatus(config, logger);
}

// Export API và modules
module.exports = {
  // Main API
  sync,
  init,
  push,
  status,

  // Core modules
  syncOrchestrator,
  runnerDetector,
  dataSync,
  serviceController,
  initRunner,
  pushRunner,
  statusRunner,

  // Adapters
  tailscale,
  git,
  ssh,
  fs: fs_adapter,
  process: process_adapter,
  http: http_adapter,

  // Utils
  Config,
  Logger,
  time,
  errors,
  constants,
};
