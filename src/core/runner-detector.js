/**
 * core/runner-detector.js
 * Phát hiện runner trước đó trên Tailscale network
 */

const tailscale = require("../adapters/tailscale");
const ssh = require("../adapters/ssh");
const { ValidationError } = require("../utils/errors");

/**
 * Parse input
 */
function parseInput(config, logger) {
  return {
    tags: String(config.tailscaleTags || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
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

  if (errors.length > 0) {
    throw new ValidationError(`Validation failed: ${errors.join(", ")}`);
  }
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
 * Lấy current working directory của GitHub Actions hoặc Azure Pipelines
 * Sử dụng absolute paths để tránh vấn đề với sudo/root user
 */
function getRunnerWorkDir(targetHost, options) {
  const { logger, sshPath } = options;

  // Danh sách các path thường gặp, check tuần tự
  const possiblePaths = [
    "/home/runner/work", // GitHub Actions (standard)
    "/home/runner/_work", // GitHub Actions (alternative)
    "/home/vsts/work", // Azure Pipelines (standard)
    "/home/vsts/work/1", // Azure Pipelines (common working dir)
  ];

  for (const path of possiblePaths) {
    const result = ssh.executeCommandCapture(targetHost, `if [ -d "${path}" ]; then echo "${path}"; fi`, { sshPath, logger });

    if (result && result.trim()) {
      logger.debug(`Found work dir: ${result.trim()}`);
      return result.trim();
    }
  }

  logger.debug(`No runner work directory found on ${targetHost}`);
  return null;
}

/**
 * Đọc metadata từ remote host
 */
function getRemoteMetadata(targetHost, options) {
  const { logger, sshPath } = options;
  const metadataPath = "/var/tmp/runner-tailscale-sync-metadata.json";

  try {
    // Thử với user runner trước
    let result = ssh.executeCommandCapture(`runner@${targetHost}`, `cat ${metadataPath} 2>/dev/null`, { sshPath, logger, silent: true });

    // Nếu không được thì thử root
    if (!result || !result.trim()) {
      result = ssh.executeCommandCapture(`root@${targetHost}`, `cat ${metadataPath} 2>/dev/null`, { sshPath, logger, silent: true });
    }

    if (!result || !result.trim()) {
      logger.debug(`No metadata file found on ${targetHost}`);
      return null;
    }

    const metadata = JSON.parse(result);
    logger.debug(`Metadata found: user=${metadata.runner?.user || metadata.env?.USER}, dataDir=${metadata.runner?.runnerDataDir}`);
    return metadata;
  } catch (err) {
    logger.debug(`Failed to read metadata from ${targetHost}: ${err.message}`);
    return null;
  }
}

/**
 * Kiểm tra xem peer có .runner-data không
 */
function checkRunnerData(targetHost, options) {
  const { logger, sshPath } = options;

  // Thử đọc metadata trước
  const metadata = getRemoteMetadata(targetHost, options);
  if (metadata && metadata.runner?.runnerDataDir) {
    const dataDir = metadata.runner.runnerDataDir;
    const user = metadata.env?.USER || "runner";

    logger.debug(`Using metadata: ${user}@${targetHost}:${dataDir}`);

    // Check nếu thư mục tồn tại
    const result = ssh.executeCommandCapture(`${user}@${targetHost}`, `test -d "${dataDir}" && echo "yes"`, { sshPath, logger, silent: true });

    return result === "yes";
  }

  // Fallback: tìm theo cách cũ
  const workDir = getRunnerWorkDir(targetHost, options);
  if (!workDir) {
    logger.debug(`No work directory found on ${targetHost}`);
    return false;
  }

  // Tìm .runner-data trong work directory
  const result = ssh.executeCommandCapture(
    targetHost,
    `find "${workDir}" -type d -name ".runner-data" -print -quit 2>/dev/null | grep -q ".runner-data" && echo "yes"`,
    { sshPath, logger },
  );

  const hasData = result === "yes";
  if (hasData) {
    logger.debug(`Found .runner-data in ${workDir} on ${targetHost}`);
  } else {
    logger.debug(`No .runner-data found in ${workDir} on ${targetHost}`);
  }

  return hasData;
}

/**
 * Execute - tìm runner trước đó dựa trên tailscale status --json
 */
async function execute(planResult, input) {
  const { logger, sshPath } = input;

  logger.info("Searching for previous runner on Tailscale network...");

  // Lấy tất cả peers từ tailscale status --json
  const status = tailscale.getStatus(logger);
  if (!status || !status.Peer) {
    logger.info("No peers found in Tailscale network");
    return {
      found: false,
      peer: null,
    };
  }

  const selfIPs = status.Self?.TailscaleIPs || [];
  logger.debug(`Self IPs: ${selfIPs.join(", ")}`);

  // Filter peers có cùng tag
  const matchingPeers = [];

  for (const [publicKey, peer] of Object.entries(status.Peer)) {
    // Bỏ qua chính máy hiện tại
    if (selfIPs.some((ip) => peer.TailscaleIPs?.includes(ip))) {
      logger.debug(`Skipping self: ${peer.HostName}`);
      continue;
    }

    // Kiểm tra tag
    const hasSameTag = planResult.tags.some((tag) => {
      const tagWithPrefix = tag.startsWith("tag:") ? tag : `tag:${tag}`;
      const tagWithoutPrefix = tag.replace(/^tag:/, "");
      return peer.Tags?.includes(tagWithPrefix) || peer.Tags?.includes(tagWithoutPrefix);
    });

    if (!hasSameTag) {
      logger.debug(`Skipping ${peer.HostName}: no matching tags`);
      continue;
    }

    // Chỉ lấy peer đang online
    if (!peer.Online) {
      logger.debug(`Skipping ${peer.HostName}: offline`);
      continue;
    }

    logger.debug(`Found peer: ${peer.HostName} (${peer.TailscaleIPs?.[0]})`);

    matchingPeers.push({
      id: peer.ID,
      publicKey: publicKey,
      hostname: peer.HostName,
      dnsName: peer.DNSName,
      ips: peer.TailscaleIPs || [],
      tags: peer.Tags || [],
      online: peer.Online,
      active: peer.Active,
      created: peer.Created,
      lastWrite: peer.LastWrite,
      lastSeen: peer.LastSeen,
      os: peer.OS,
    });
  }

  if (matchingPeers.length === 0) {
    logger.info(`No peer(s) with matching tags found`);
    return {
      found: false,
      peer: null,
    };
  }

  logger.info(`Found ${matchingPeers.length} peer(s) with matching tags`);

  // Kiểm tra SSH connection cho từng peer
  for (const peer of matchingPeers) {
    const targetHost = peer.ips?.[0];
    if (!targetHost) {
      peer.accessible = false;
      logger.debug(`Peer ${peer.hostname}: no IP address`);
      continue;
    }

    logger.debug(`Testing SSH connection to ${targetHost}...`);
    peer.accessible = await Promise.resolve(ssh.checkConnection(targetHost, { logger, sshPath }));

    if (peer.accessible) {
      logger.debug(`Peer ${peer.hostname}: SSH accessible`);
    } else {
      logger.debug(`Peer ${peer.hostname}: SSH not accessible`);
    }
  }

  const accessiblePeers = matchingPeers.filter((peer) => peer.accessible);

  if (accessiblePeers.length === 0) {
    logger.info("No accessible peers found");
    return {
      found: false,
      peer: null,
    };
  }

  logger.info(`Found ${accessiblePeers.length} accessible peer(s)`);

  // Kiểm tra .runner-data cho từng accessible peer
  for (const peer of accessiblePeers) {
    const targetHost = peer.ips?.[0];
    if (!targetHost) {
      peer.hasData = false;
      continue;
    }

    logger.debug(`Checking .runner-data on ${peer.hostname} (${targetHost})...`);
    peer.hasData = checkRunnerData(targetHost, { logger, sshPath });

    // Lưu metadata vào peer nếu có
    if (peer.hasData) {
      peer.metadata = getRemoteMetadata(targetHost, { logger, sshPath });
    }
  }

  // Lọc peers có data và sắp xếp theo thời gian tạo gần nhất
  const peersWithData = accessiblePeers
    .filter((item) => item.hasData)
    .slice()
    .sort((a, b) => {
      // Ưu tiên peer có Created gần nhất
      const ta = a.created ? Date.parse(a.created) : 0;
      const tb = b.created ? Date.parse(b.created) : 0;
      return tb - ta; // Mới nhất trước
    });

  if (peersWithData.length > 0) {
    logger.debug(`Found ${peersWithData.length} peer(s) with .runner-data`);
  }

  const peer = peersWithData[0];

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
  logger.info(`  Created: ${peer.created || "N/A"}`);
  logger.info(`  Active: ${peer.active ? "Yes" : "No"}`);

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
  validate(input);

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
  getRunnerWorkDir,
  checkRunnerData,
  getRemoteMetadata,
};
