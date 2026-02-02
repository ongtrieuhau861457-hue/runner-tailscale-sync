/**
 * cli/parser.js
 * Parse command-line arguments
 */

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    cwd: null,
    verbose: false,
    quiet: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--cwd" && i + 1 < args.length) {
      options.cwd = args[++i];
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
      continue;
    }

    if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--version") {
      options.version = true;
      continue;
    }
  }

  return { options };
}

function printHelp() {
  console.log(`
runner-tailscale-sync - Đồng bộ runner data qua Tailscale network

USAGE:
  runner-sync [options]

DESCRIPTION:
  Tự động chạy workflow: init → detect → pull → stop → push
  - Init: Cài đặt và kết nối Tailscale
  - Detect: Tìm runner trước đó trên mạng
  - Pull: Đồng bộ .runner-data (nếu có runner cũ)
  - Stop: Dừng services trên runner cũ (nếu có)
  - Push: Đẩy code lên git

OPTIONS:
  --cwd <path>    Set working directory (default: current dir)
  --verbose       Enable verbose logging
  --quiet         Suppress non-error output
  --help, -h      Show this help
  --version       Show version

ENVIRONMENT VARIABLES:
  TAILSCALE_CLIENT_ID       OAuth client ID (required if TAILSCALE_ENABLE=1)
  TAILSCALE_CLIENT_SECRET   OAuth client secret (required if TAILSCALE_ENABLE=1)
  TAILSCALE_TAGS            Tailscale tags (default: tag:ci)
  TAILSCALE_ENABLE          Enable Tailscale (0 or 1, default: 0)
  SERVICES_TO_STOP          Services to stop on old runner (default: cloudflared,pocketbase)
  GIT_PUSH_ENABLED          Enable git push (0 or 1, default: 1)
  GIT_BRANCH                Git branch (default: main)
  TOOL_CWD                  Working directory (can be overridden by --cwd)

EXAMPLES:
  # Run full workflow
  TAILSCALE_ENABLE=1 runner-sync

  # Verbose mode
  runner-sync --verbose

  # Custom working directory
  runner-sync --cwd /path/to/project

For more info: https://github.com/yourname/runner-tailscale-sync
`);
}

module.exports = {
  parseArgs,
  printHelp,
};
