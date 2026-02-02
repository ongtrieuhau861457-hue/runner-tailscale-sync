/**
 * logger.js
 * Logger với masking sensitive data và version info
 */

const path = require("path");
const { getTimestamp } = require("./time");

class Logger {
  constructor(options = {}) {
    this.packageName = options.packageName || "runner-tailscale-sync";
    this.version = options.version || "unknown";
    this.verbose = options.verbose || false;
    this.quiet = options.quiet || false;
    this.command = options.command || "";

    // Danh sách giá trị phổ biến KHÔNG mask
    this.skipValues = new Set([
      "true", "false", "TRUE", "FALSE", 
      "null", "undefined", "NULL",
      "production", "development", "test", "staging"
    ]);

    // Danh sách key patterns cần mask
    this.sensitivePatterns = [
      "PASSWORD", "SECRET", "KEY", "TOKEN", "API",
      "CLIENT_ID", "CLIENT_SECRET", "AUTH", "OAUTH",
      "PRIVATE", "CREDENTIAL", "ACCESS", "PASSPHRASE",
    ];
  }

  /**
   * Mask sensitive values trong message
   */
  maskSensitiveData(msg) {
    let maskedMsg = msg;

    const envValues = Object.entries(process.env)
      .filter(([key, value]) => {
        if (!value || typeof value !== "string") return false;
        const trimmed = value.trim();

        if (trimmed.length < 6) return false;
        if (this.skipValues.has(trimmed)) return false;
        if (/^\d+$/.test(trimmed)) return false;

        const upperKey = key.toUpperCase();
        return this.sensitivePatterns.some(pattern => upperKey.includes(pattern));
      })
      .map(([key, value]) => value.trim().replace(/\s+/g, " "))
      .sort((a, b) => b.length - a.length);

    const uniqueValues = [...new Set(envValues)];

    for (const value of uniqueValues) {
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const whitespacePattern = escapedValue.replace(/\s+/g, "\\s+");
      const regex = new RegExp(whitespacePattern, "g");
      maskedMsg = maskedMsg.replace(regex, "*".repeat(value.length));
    }

    maskedMsg = maskedMsg.replace(/tskey-[a-zA-Z0-9]{30,}/g, "***TAILSCALE_KEY***");
    maskedMsg = maskedMsg.replace(/ghp_[a-zA-Z0-9]{36}/g, "***GITHUB_TOKEN***");
    maskedMsg = maskedMsg.replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "***BASE64_SECRET***");

    return maskedMsg;
  }

  /**
   * Format message với prefix
   */
  format(level, msg) {
    const timestamp = getTimestamp();
    const prefix = `[${this.packageName}@${this.version}]`;
    const timePrefix = `[${timestamp}]`;
    return `${timePrefix} ${prefix} ${level} ${msg}`;
  }

  /**
   * Log info
   */
  info(msg) {
    if (this.quiet) return;
    const formatted = this.format("ℹ️", msg);
    const masked = this.maskSensitiveData(formatted);
    process.stdout.write(masked + "\n");
  }

  /**
   * Log success
   */
  success(msg) {
    if (this.quiet) return;
    const formatted = this.format("✅", msg);
    const masked = this.maskSensitiveData(formatted);
    process.stdout.write(masked + "\n");
  }

  /**
   * Log warning
   */
  warn(msg) {
    const formatted = this.format("⚠️", msg);
    const masked = this.maskSensitiveData(formatted);
    process.stderr.write(masked + "\n");
  }

  /**
   * Log error
   */
  error(msg) {
    const formatted = this.format("❌", msg);
    const masked = this.maskSensitiveData(formatted);
    process.stderr.write(masked + "\n");
  }

  /**
   * Log debug (chỉ khi verbose)
   */
  debug(msg) {
    if (!this.verbose) return;
    const formatted = this.format("🔍", msg);
    const masked = this.maskSensitiveData(formatted);
    process.stdout.write(masked + "\n");
  }

  /**
   * Log command execution
   */
  command(cmd) {
    if (this.quiet) return;
    const formatted = this.format("🔧", cmd);
    const masked = this.maskSensitiveData(formatted);
    process.stdout.write(masked + "\n");
  }

  /**
   * Print banner khi khởi động
   */
  printBanner() {
    if (this.quiet) return;
    this.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.info(`📦 ${this.packageName} - version ${this.version}`);
    if (this.command) {
      this.info(`🎯 Command: ${this.command}`);
    }
    this.info(`🕐 Started at: ${getTimestamp()} (VN Time)`);
    this.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}

module.exports = Logger;
