/**
 * config.js
 * Load configuration từ .env, CLI flags, và defaults
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const CONST = require("./constants");

class Config {
  constructor(options = {}) {
    // Load .env file nếu có
    this.loadEnvFile();

    // Determine CWD (priority: CLI flag > env > process.cwd())
    this.cwd = options.cwd || process.env.TOOL_CWD || process.cwd();

    // Runner data directory
    this.runnerDataDir = path.join(this.cwd, CONST.RUNNER_DATA_DIR);
    this.logsDir = path.join(this.runnerDataDir, CONST.LOGS_DIR);
    this.pidDir = path.join(this.runnerDataDir, CONST.PID_DIR);
    this.dataServicesDir = path.join(this.runnerDataDir, CONST.DATA_SERVICES_DIR);
    this.tmpDir = path.join(this.runnerDataDir, CONST.TMP_DIR);

    // Tailscale config
    this.tailscaleClientId = process.env.TAILSCALE_CLIENT_ID || "";
    this.tailscaleClientSecret = process.env.TAILSCALE_CLIENT_SECRET || "";
    this.tailscaleTags = process.env.TAILSCALE_TAGS || CONST.DEFAULT_TAG;
    this.tailscaleEnable = ["1", 1].includes(process.env.TAILSCALE_ENABLE?.trim());

    // Services to stop on previous runner
    this.servicesToStop = this.parseServicesList(process.env.SERVICES_TO_STOP || "cloudflared,pocketbase,http-server");

    // Platform detection
    this.isWindows = os.platform() === "win32";
    this.isLinux = os.platform() === "linux";
    this.isMacOS = os.platform() === "darwin";

    // Logging
    this.verbose = options.verbose || false;
    this.quiet = options.quiet || false;

    // Git
    this.gitEnabled = String(process.env.GIT_PUSH_ENABLED || "1").trim() === "1";
    this.gitBranch = process.env.GIT_BRANCH || "main";

    // SSH/Rsync paths (for Windows)
    this.sshPath = process.env.SSH_PATH || "ssh";
    this.rsyncPath = process.env.RSYNC_PATH || "rsync";
  }

  /**
   * Load .env file
   */
  loadEnvFile() {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    try {
      const content = fs.readFileSync(envPath, "utf8");
      content.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;

        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();

          // Remove quotes
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          // Only set if not already in env
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Parse comma-separated services list
   */
  parseServicesList(str) {
    return str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Validate required config
   */
  validate() {
    const errors = [];

    if (this.tailscaleEnable) {
      if (!this.tailscaleClientId) {
        errors.push("TAILSCALE_CLIENT_ID is required when TAILSCALE_ENABLE=1");
      }
      if (!this.tailscaleClientSecret) {
        errors.push("TAILSCALE_CLIENT_SECRET is required when TAILSCALE_ENABLE=1");
      }
    }

    return errors;
  }

  /**
   * Get all directories that need to be created
   */
  getDirectoriesToEnsure() {
    return [this.runnerDataDir, this.logsDir, this.pidDir, this.dataServicesDir, this.tmpDir];
  }
}

module.exports = Config;
