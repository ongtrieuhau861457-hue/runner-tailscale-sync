/**
 * core/status.js
 * Show Tailscale status and runner info
 */

const tailscale = require("../adapters/tailscale");
const fs_adapter = require("../adapters/fs");

/**
 * Parse input
 */
function parseInput(config, logger) {
  return {
    tailscaleEnable: config.tailscaleEnable,
    tailscaleTags: config.tailscaleTags,
    runnerDataDir: config.runnerDataDir,
    logger,
  };
}

/**
 * Validate
 */
function validate() {
  return [];
}

/**
 * Plan
 */
function plan() {
  return {
    action: "status",
  };
}

/**
 * Execute
 */
async function execute(planResult, input) {
  const { logger } = input;

  const result = {
    tailscale: null,
    peers: [],
    peerCount: 0,
    runnerData: null,
  };

  if (input.tailscaleEnable) {
    const status = tailscale.getStatus(logger);
    result.tailscale = status || null;

    if (status) {
      result.peerCount = status.Peer ? Object.keys(status.Peer).length : 0;
      result.peers = tailscale.findPeersWithTag(input.tailscaleTags, logger);
    }
  }

  if (fs_adapter.exists(input.runnerDataDir)) {
    result.runnerData = {
      path: input.runnerDataDir,
      size: fs_adapter.getDirSize(input.runnerDataDir),
    };
  }

  return result;
}

/**
 * Report
 */
function report(result, input) {
  const { logger } = input;

  if (input.tailscaleEnable) {
    if (result.tailscale) {
      logger.info("━━━ Tailscale Status ━━━");
      logger.info(`Backend: ${result.tailscale.BackendState}`);

      if (result.tailscale.Self) {
        logger.info(`Hostname: ${result.tailscale.Self.HostName || "N/A"}`);
        logger.info(`DNS: ${result.tailscale.Self.DNSName || "N/A"}`);
        logger.info(`IPs: ${result.tailscale.Self.TailscaleIPs?.join(", ") || "N/A"}`);
      }

      if (result.peers.length > 0) {
        logger.info(`Peers: ${result.peerCount} connected`);
        logger.info(`Peers with tag '${input.tailscaleTags}':`);
        result.peers.forEach((peer, i) => {
          logger.info(`  ${i + 1}. ${peer.hostname} (${peer.ips[0]})`);
        });
      }
    } else {
      logger.warn("Tailscale not connected");
    }
  } else {
    logger.info("Tailscale disabled");
  }

  logger.info("━━━ Runner Data ━━━");
  if (result.runnerData) {
    logger.info(`Directory: ${result.runnerData.path}`);
    logger.info(`Size: ${fs_adapter.formatBytes(result.runnerData.size)}`);
  } else {
    logger.warn(`Directory not found: ${input.runnerDataDir}`);
  }

  return { success: true };
}

/**
 * Main status function
 */
async function showStatus(config, logger) {
  const input = parseInput(config, logger);
  validate(input);
  const planResult = plan(input);
  const execResult = await execute(planResult, input);
  return report(execResult, input);
}

module.exports = {
  showStatus,
  parseInput,
  validate,
  plan,
  execute,
  report,
};
