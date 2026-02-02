/**
 * core/runner-detector.js
 * Phát hiện runner trước đó trên Tailscale network
 */

const tailscale = require("../adapters/tailscale");
const ssh = require("../adapters/ssh");

/**
 * Parse input
 */
function parseInput(config, logger) {
  return {
    tags: String(config.tailscaleTags || "").split(",").map(s=>s.trim()).filter(Boolean),
    sshPath: config.sshPath,
    logger,
  };
}

/**
 * Validate
 */
function validate(input) {
  const errors = [];

  if (!input.tags || input.tags.length === 0) {
    errors.push("Tailscale tag is required");
  }

  return errors;
}

/**
 * Plan - xác định strategy
 */
function plan(input) {
  return {
    action: "detect_previous_runner",
    tags: input.tags,
  };
}

/**
 * Execute - tìm runner trước đó
 */
async function execute(planResult, input) {
  const { logger } = input;

  logger.info("Searching for previous runner on Tailscale network...");

  // Get all peers with same tag
  const peers = tailscale.findPeersWithTag(planResult.tags, logger);

  if (peers.length === 0) {
    logger.info("No previous runner found");
    return {
      found: false,
      peer: null,
    };
  }

  for (const peer of peers) {
    const targetHost = peer.ips?.[0];
    if (!targetHost) {
      peer.accessible = false;
      continue;
    }
    peer.accessible = await Promise.resolve(
      ssh.checkConnection(targetHost, { logger, sshPath: input.sshPath })
    );
  }

  const accessiblePeers = peers.filter((peer) => peer.accessible);

  for (const peer of accessiblePeers) {
    const targetHost = peer.ips?.[0];
    if (!targetHost) {
      peer.hasData = false;
      continue;
    }
    const result = ssh.executeCommandCapture(
      targetHost,
      'test -d .runner-data && echo "yes"',
      { sshPath: input.sshPath }
    );
    peer.hasData = result === "yes";
  }

  const peer = accessiblePeers
    .filter((item) => item.hasData)
    .slice()
    .sort((a, b) => {
      const ta = a.lastSeen ? Date.parse(a.lastSeen) : 0;
      const tb = b.lastSeen ? Date.parse(b.lastSeen) : 0;
      return tb - ta;
    })[0];

  if (!peer) {
    logger.info("No accessible runner with data found");
    return {
      found: false,
      peer: null,
    };
  }

  logger.success(`Found previous runner: ${peer.hostname || peer.id}`);
  logger.info(`  IP: ${peer.ips[0] || "N/A"}`);
  logger.info(`  DNS: ${peer.dnsName || "N/A"}`);

  return {
    found: true,
    peer,
  };
}

/**
 * Report
 */
function report(result, input) {
  const { logger } = input;

  if (result.found) {
    logger.success("Previous runner detected");
    return {
      success: true,
      previousRunner: result.peer,
    };
  } else {
    logger.info("No previous runner - this is the first runner");
    return {
      success: true,
      previousRunner: null,
    };
  }
}

/**
 * Main detect function
 */
async function detectPreviousRunner(config, logger) {
  // Step 1: Parse Input
  const input = parseInput(config, logger);

  // Step 2: Validate
  const errors = validate(input);
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(", ")}`);
  }

  // Step 3: Plan
  const planResult = plan(input);

  // Step 4: Execute
  const execResult = await execute(planResult, input);

  // Step 5: Report
  return report(execResult, input);
}

module.exports = {
  detectPreviousRunner,
  parseInput,
  validate,
  plan,
  execute,
  report,
};
