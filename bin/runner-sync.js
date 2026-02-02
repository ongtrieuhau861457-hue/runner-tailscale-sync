#!/usr/bin/env node
/**
 * bin/runner-sync.js
 * CLI entry point - Always run full workflow
 */

const Config = require("../src/utils/config");
const Logger = require("../src/utils/logger");
const { parseArgs, printHelp } = require("../src/cli/parser");
const syncOrchestrator = require("../src/core/sync-orchestrator");
const pkg = require("../package.json");

// Parse arguments
const { options } = parseArgs(process.argv);

// Handle help
if (options.help) {
  printHelp();
  process.exit(0);
}

// Handle version
if (options.version) {
  console.log(`${pkg.name} v${pkg.version}`);
  process.exit(0);
}

// Create config & logger
const config = new Config(options);
const logger = new Logger({
  packageName: pkg.name,
  version: pkg.version,
  command: "sync",
  verbose: options.verbose,
  quiet: options.quiet,
});

// Print banner
logger.printBanner();

// Run full workflow
(async () => {
  try {
    const result = await syncOrchestrator.orchestrate(config, logger);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    logger.error(err.message);
    if (options.verbose && err.stack) {
      logger.debug(err.stack);
    }
    process.exit(err.exitCode || 1);
  }
})();
