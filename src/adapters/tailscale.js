/**
 * adapters/tailscale.js
 * Tailscale operations: install, connect, status
 */

const os = require("os");
const { spawn } = require("child_process");
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
  if (process_adapter.commandExists("tailscale")) {
    logger.success("Tailscale already installed");
    const version = process_adapter.runCapture("tailscale version");
    if (version) {
      logger.info(`Version: ${version.split("\n")[0]}`);
    }
    return true;
  }

  logger.info("Installing Tailscale...");

  if (isLinux) {
    process_adapter.run("curl -fsSL https://tailscale.com/install.sh | sh", { 
      logger,
      ignoreError: false 
    });

    process_adapter.run("sudo systemctl enable --now tailscaled", { 
      logger,
      ignoreError: true 
    });

    logger.success("Tailscale installed on Linux");
    return true;
  }

  if (isMacOS) {
    logger.error("macOS detected. Install via: brew install tailscale");
    return false;
  }

  if (isWindows) {
    logger.error("Windows detected. Download from: https://tailscale.com/download/windows");
    logger.info("After install, ensure 'tailscale' is in PATH");
    return false;
  }

  logger.error("Unsupported OS for auto-install");
  return false;
}

/**
 * Get Tailscale status as JSON
 */
function getStatus(logger) {
  const statusStr = process_adapter.runCapture("tailscale status --json");
  if (!statusStr) return null;

  try {
    return JSON.parse(statusStr);
  } catch (err) {
    if (logger) {
      logger.debug(`Failed to parse Tailscale status: ${err.message}`);
    }
    return null;
  }
}

/**
 * Check if logged in
 */
function isLoggedIn(logger) {
  const status = getStatus(logger);
  return status && status.BackendState === "Running";
}

/**
 * Get Tailscale IPv4
 */
function getIP(logger) {
  const status = getStatus(logger);
  if (!status || !status.Self) return null;

  const ipv4 = status.Self.TailscaleIPs?.find(ip => !ip.includes(":"));
  return ipv4 || null;
}

/**
 * Get Tailscale hostname
 */
function getHostname(logger) {
  const status = getStatus(logger);
  if (!status || !status.Self) return null;
  return status.Self.DNSName?.replace(/\.$/, "") || null;
}

/**
 * Login với OAuth credentials
 */
async function login(clientId, clientSecret, tags, logger, config) {
  logger.info("Logging in to Tailscale with OAuth client...");

  const tagStr = tags ? `--advertise-tags=${tags}` : "";
  
  const sshFlag = (config.isLinux && !config.isWindows) ? "--ssh" : "";
  const baseArgs = [
    "tailscale",
    "up",
    "--auth-stdin",
    "--accept-routes",
    "--accept-dns=true",
    sshFlag,
    tagStr,
  ].filter(Boolean);

  const cmd = config.isWindows ? baseArgs : ["sudo", ...baseArgs];

  await new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "inherit", "inherit"] });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new ProcessError(`tailscale up failed with code ${code}`));
      }
    });

    child.stdin.write(`${clientId}\n${clientSecret}\n`);
    child.stdin.end();
  });

  logger.info("Waiting for Tailscale connection...");
  const connected = await process_adapter.waitForCondition(
    () => isLoggedIn(logger),
    CONST.CONNECTION_TIMEOUT,
    CONST.STATUS_CHECK_INTERVAL
  );

  if (!connected) {
    throw new ProcessError("Tailscale failed to connect after 30s");
  }

  logger.success("Tailscale connected successfully");
  return true;
}

/**
 * Cleanup Tailscale
 */
function cleanup(logger, config) {
  logger.info("Cleaning up Tailscale...");
  
  const sudoPrefix = config.isWindows ? "" : "sudo ";
  
  process_adapter.run(`${sudoPrefix}tailscale down`, { 
    logger, 
    ignoreError: true 
  });
  
  process_adapter.run(`${sudoPrefix}tailscale logout`, { 
    logger, 
    ignoreError: true 
  });
}

/**
 * Find peers with same tag (excluding self)
 */
function findPeersWithTag(tags, logger) {
  const tagList = Array.isArray(tags)
    ? tags
    : String(tags || "").split(",").map(s => s.trim()).filter(Boolean);

  const status = getStatus(logger);
  if (!status || !status.Peer) return [];

  const selfId = status.Self?.ID;
  const peers = [];

  for (const [peerId, peerInfo] of Object.entries(status.Peer)) {
    if (peerId === selfId) continue;

    // Check if peer has the tag
    const hasSameTag = tagList.length === 0 ? true : tagList.some(t => peerInfo.Tags?.includes(t));
    
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
      });
    }
  }

  return peers;
}

module.exports = {
  install,
  getStatus,
  isLoggedIn,
  getIP,
  getHostname,
  login,
  cleanup,
  findPeersWithTag,
};
