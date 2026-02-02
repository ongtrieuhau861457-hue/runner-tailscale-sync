/**
 * adapters/tailscale.js
 * Tailscale operations: install, connect, status
 *
 * FIXED VERSION - Corrected OAuth login flow
 */

const os = require("os");
const process_adapter = require("./process");
const { ProcessError } = require("../utils/errors");
const CONST = require("../utils/constants");

const isWindows = os.platform() === "win32";
const isLinux = os.platform() === "linux";
const isMacOS = os.platform() === "darwin";

/**
 * Install Tailscale
 */
function install(logger) {
  // Check if already installed
  if (process_adapter.commandExists("tailscale")) {
    logger.success("Tailscale already installed");

    try {
      const version = process_adapter.runCapture("tailscale version");
      if (version) {
        logger.info(`Version: ${version.split("\n")[0]}`);
      }
    } catch (err) {
      logger.debug(`Could not get version: ${err.message}`);
    }

    return true;
  }

  logger.info("Installing Tailscale...");

  if (isLinux) {
    try {
      // Download and run install script
      logger.info("Downloading Tailscale install script...");
      process_adapter.run("curl -fsSL https://tailscale.com/install.sh | sh", {
        logger,
        ignoreError: false,
      });

      // Enable and start tailscaled service
      logger.info("Enabling tailscaled service...");
      process_adapter.run("sudo systemctl enable --now tailscaled", {
        logger,
        ignoreError: true, // May already be enabled
      });

      // Verify installation
      if (!process_adapter.commandExists("tailscale")) {
        throw new ProcessError("Tailscale installed but command not found in PATH");
      }

      logger.success("Tailscale installed successfully on Linux");
      return true;
    } catch (err) {
      throw new ProcessError(`Failed to install Tailscale on Linux: ${err.message}`);
    }
  }

  if (isMacOS) {
    logger.error("macOS detected. Please install Tailscale manually:");
    logger.info("  Option 1: brew install tailscale");
    logger.info("  Option 2: Download from https://tailscale.com/download/mac");
    return false;
  }

  if (isWindows) {
    logger.error("Windows detected. Please install Tailscale manually:");
    logger.info("  1. Download from: https://tailscale.com/download/windows");
    logger.info("  2. Run the installer");
    logger.info("  3. Ensure 'tailscale' is in PATH");
    logger.info("  4. Restart terminal and try again");
    return false;
  }

  logger.error(`Unsupported OS for auto-install: ${os.platform()}`);
  return false;
}

/**
 * Get Tailscale status as JSON
 */
function getStatus(logger) {
  try {
    const statusStr = process_adapter.runCapture("tailscale status --json");
    if (!statusStr) return null;

    return JSON.parse(statusStr);
  } catch (err) {
    if (logger) {
      logger.debug(`Failed to get Tailscale status: ${err.message}`);
    }
    return null;
  }
}

/**
 * Check if logged in and connected
 */
function isLoggedIn(logger) {
  const status = getStatus(logger);
  return status && status.BackendState === "Running";
}

/**
 * Get Tailscale IPv4 address
 */
function getIP(logger) {
  const status = getStatus(logger);
  if (!status || !status.Self) return null;

  // Find first IPv4 address (no colons)
  const ipv4 = status.Self.TailscaleIPs?.find((ip) => !ip.includes(":"));
  return ipv4 || null;
}

/**
 * Get Tailscale hostname
 */
function getHostname(logger) {
  const status = getStatus(logger);
  if (!status || !status.Self) return null;

  // Remove trailing dot from DNS name
  return status.Self.DNSName?.replace(/\.$/, "") || null;
}

/**
 * Login với OAuth credentials
 *
 * OAuth login format: --auth-key=CLIENT_ID:CLIENT_SECRET
 * Platform differences:
 * - Linux: needs sudo, supports --ssh
 * - Windows: no sudo, no --ssh
 * - macOS: no sudo, no --ssh (usually)
 */
async function login(clientId, clientSecret, tags, logger, config) {
  logger.info("Logging in to Tailscale with OAuth client...");

  // Validate inputs
  if (!clientId || !clientSecret) {
    throw new ProcessError("TAILSCALE_CLIENT_ID and TAILSCALE_CLIENT_SECRET are required");
  }

  // Build tag parameter
  const tagStr = tags ? `--advertise-tags=${tags}` : "";

  // Build command array (will be filtered and joined)
  const cmdParts = [
    // Linux needs sudo
    config.isLinux ? "sudo" : "",

    "tailscale",
    "up",

    // OAuth auth key
    `--client-id=${clientId}`,
    `--client-secret=${clientSecret}`,

    // Network settings
    "--accept-routes",
    "--accept-dns=true",

    // SSH support (Linux only)
    config.isLinux ? "--ssh" : "",

    // Tags
    tagStr,
  ].filter(Boolean); // Remove empty strings

  const cmd = cmdParts.join(" ");

  // Log command (with masked auth key)
  const maskedCmd = cmd.replace(clientId, "***MASKED***").replace(clientSecret, "***MASKED***");
  logger.debug(`Executing: ${maskedCmd}`);

  // Execute tailscale up
  try {
    process_adapter.run(cmd, {
      logger,
      ignoreError: false,
    });
  } catch (err) {
    // Provide helpful error messages
    let errorMsg = `Tailscale up failed: ${err.message}`;

    if (err.message.includes("authentication")) {
      errorMsg += "\n  → Check: OAuth credentials are valid and not expired";
    }
    if (err.message.includes("tag")) {
      errorMsg += "\n  → Check: Tags are authorized in Tailscale ACL";
    }
    if (err.message.includes("permission")) {
      errorMsg += "\n  → Check: Running with sufficient permissions (sudo on Linux)";
    }

    throw new ProcessError(errorMsg);
  }

  // Wait for Tailscale to be fully connected
  logger.info("Waiting for Tailscale connection...");

  const connected = await process_adapter.waitForCondition(
    () => {
      try {
        return isLoggedIn(logger);
      } catch (err) {
        logger.debug(`Status check error: ${err.message}`);
        return false;
      }
    },
    CONST.CONNECTION_TIMEOUT,
    CONST.STATUS_CHECK_INTERVAL,
  );

  if (!connected) {
    // Get current status for debugging
    const status = getStatus(logger);
    const backendState = status?.BackendState || "unknown";

    throw new ProcessError(
      `Tailscale failed to connect after ${CONST.CONNECTION_TIMEOUT / 1000}s. ` +
        `Backend state: ${backendState}.\n` +
        `  → Check: (1) OAuth credentials valid, (2) Network accessible, (3) Tags authorized`,
    );
  }

  // Verify we got IP and hostname
  const ip = getIP(logger);
  const hostname = getHostname(logger);

  if (!ip && !hostname) {
    throw new ProcessError("Tailscale connected but no IP/hostname assigned");
  }

  logger.success("Tailscale connected successfully");
  logger.info(`  IP: ${ip || "N/A"}`);
  logger.info(`  Hostname: ${hostname || "N/A"}`);

  return true;
}

/**
 * Logout and cleanup
 */
function logout(logger, config) {
  logger.info("Logging out of Tailscale...");

  const sudoPrefix = config.isLinux ? "sudo " : "";

  // Try to logout gracefully
  process_adapter.run(`${sudoPrefix}tailscale logout`, {
    logger,
    ignoreError: true,
  });

  logger.success("Logged out of Tailscale");
}

/**
 * Disconnect (down) but don't logout
 */
function down(logger, config) {
  logger.info("Bringing down Tailscale connection...");

  const sudoPrefix = config.isLinux ? "sudo " : "";

  process_adapter.run(`${sudoPrefix}tailscale down`, {
    logger,
    ignoreError: true,
  });

  logger.success("Tailscale connection down");
}

/**
 * Full cleanup (down + logout)
 */
function cleanup(logger, config) {
  logger.info("Cleaning up Tailscale...");

  down(logger, config);
  logout(logger, config);

  logger.success("Tailscale cleanup complete");
}

/**
 * Find peers with same tag (excluding self)
 *
 * Returns array of peer objects with:
 * - id: Peer ID
 * - hostname: Machine hostname
 * - dnsName: Tailscale DNS name
 * - ips: Array of Tailscale IPs
 * - online: Boolean
 * - lastSeen: Timestamp or null
 */
function findPeersWithTag(tags, logger) {
  // Parse tags (support both string and array)
  const tagList = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  // Get status
  const status = getStatus(logger);
  if (!status || !status.Peer) {
    logger.debug("No peers found or status unavailable");
    return [];
  }

  const selfId = status.Self?.ID;
  const peers = [];

  // Iterate through all peers
  for (const [peerId, peerInfo] of Object.entries(status.Peer)) {
    // Skip self
    if (peerId === selfId) {
      logger.debug(`Skipping self: ${peerId}`);
      continue;
    }

    // Check if peer has any of the required tags
    let hasSameTag = false;

    if (tagList.length === 0) {
      // No tags specified - include all peers
      hasSameTag = true;
    } else {
      // Check if peer has any of the specified tags
      hasSameTag = tagList.some((tag) => peerInfo.Tags?.includes(tag));
    }

    // Check if peer is online
    const isOnline = peerInfo.Online === true;

    if (hasSameTag && isOnline) {
      peers.push({
        id: peerId,
        hostname: peerInfo.HostName,
        dnsName: peerInfo.DNSName?.replace(/\.$/, ""),
        ips: peerInfo.TailscaleIPs || [],
        online: isOnline,
        lastSeen: peerInfo.LastSeen || null,
        tags: peerInfo.Tags || [],
      });

      logger.debug(`Found peer: ${peerInfo.HostName} (${peerInfo.TailscaleIPs?.[0]})`);
    }
  }

  logger.info(`Found ${peers.length} peer(s) with matching tags`);
  return peers;
}

/**
 * Get detailed peer info by hostname or IP
 */
function getPeerInfo(hostnameOrIp, logger) {
  const status = getStatus(logger);
  if (!status || !status.Peer) return null;

  for (const [peerId, peerInfo] of Object.entries(status.Peer)) {
    if (
      peerInfo.HostName === hostnameOrIp ||
      peerInfo.DNSName?.replace(/\.$/, "") === hostnameOrIp ||
      peerInfo.TailscaleIPs?.includes(hostnameOrIp)
    ) {
      return {
        id: peerId,
        hostname: peerInfo.HostName,
        dnsName: peerInfo.DNSName?.replace(/\.$/, ""),
        ips: peerInfo.TailscaleIPs || [],
        online: peerInfo.Online === true,
        lastSeen: peerInfo.LastSeen || null,
        tags: peerInfo.Tags || [],
      };
    }
  }

  return null;
}

module.exports = {
  install,
  getStatus,
  isLoggedIn,
  getIP,
  getHostname,
  login,
  logout,
  down,
  cleanup,
  findPeersWithTag,
  getPeerInfo,
};
