# runner-tailscale-sync

Đồng bộ runner-data giữa các runner trên GitHub Actions, Azure Pipeline qua Tailscale network.

## ✨ Tính năng

- 🔄 Tự động đồng bộ `.runner-data` giữa các runner
- 🌐 Sử dụng Tailscale để kết nối an toàn giữa runners
- 🛑 Tự động stop services trên runner cũ khi runner mới bắt đầu
- 📦 Push data lên git repository
- 🎯 Hỗ trợ cả CLI và Library
- 🪟 Cross-platform (Windows + Linux)
- 📊 Logging chi tiết với version tracking

## 📦 Cài đặt

```bash
npm install runner-tailscale-sync

# Hoặc global
npm install -g runner-tailscale-sync
```

## 🚀 Sử dụng

### CLI

```bash
# Run full workflow (init → detect → pull → stop → push)
TAILSCALE_ENABLE=1 runner-sync

# Custom working directory
runner-sync --cwd /path/to/project

# Verbose mode
runner-sync --verbose

# Quiet mode
runner-sync --quiet
```

**Workflow tự động**:

1. **Init**: Cài đặt Tailscale và kết nối mạng
2. **Detect**: Tìm runner trước đó (cùng tag)
3. **Pull**: Đồng bộ `.runner-data` từ runner cũ (nếu có)
4. **Stop**: Dừng services trên runner cũ (nếu có)
5. **Push**: Đẩy `.runner-data` lên git (nếu có runner cũ)

### Library

```javascript
const runnerSync = require("runner-tailscale-sync");

// Run full workflow
await runnerSync.sync({
  cwd: "/path/to/project",
  verbose: true,
});

// Access individual modules (advanced)
const { Config, Logger, syncOrchestrator } = require("runner-tailscale-sync");

const config = new Config({ cwd: process.cwd() });
const logger = new Logger({ packageName: "my-tool", version: "1.0.0" });

await syncOrchestrator.orchestrate(config, logger);
```

### Advanced Usage - Sử dụng modules riêng lẻ

```javascript
const { Config, Logger, syncOrchestrator, runnerDetector, dataSync, tailscale } = require("runner-tailscale-sync");

// Tạo config
const config = new Config({ cwd: process.cwd() });
const logger = new Logger({ packageName: "my-tool", version: "1.0.0" });

// Detect previous runner
const detection = await runnerDetector.detectPreviousRunner(config, logger);

// Pull data
if (detection.previousRunner) {
  await dataSync.pullData(config, detection.previousRunner, logger);
}

// Hoặc orchestrate toàn bộ
await syncOrchestrator.orchestrate(config, logger);
```

## ⚙️ Cấu hình

### Environment Variables

```bash
# Tailscale (required nếu TAILSCALE_ENABLE=1)
TAILSCALE_CLIENT_ID=your_client_id
TAILSCALE_CLIENT_SECRET=your_client_secret
TAILSCALE_TAGS=tag:ci
TAILSCALE_ENABLE=1

# Services to stop on previous runner
SERVICES_TO_STOP=cloudflared,pocketbase,http-server

# Git
GIT_PUSH_ENABLED=1
GIT_BRANCH=main

# Working directory
TOOL_CWD=/path/to/project
```

### .env File

```env
TAILSCALE_CLIENT_ID=tskey-client-xxxxx
TAILSCALE_CLIENT_SECRET=tskey-xxxxx
TAILSCALE_TAGS=tag:ci
TAILSCALE_ENABLE=1
SERVICES_TO_STOP=cloudflared,pocketbase
GIT_PUSH_ENABLED=1
GIT_BRANCH=main
```

## 📂 Cấu trúc dữ liệu

Tất cả dữ liệu được lưu trong `.runner-data/`:

```
.runner-data/
├── logs/              # Log files
├── pid/               # PID files
├── data-services/     # Service data
└── tmp/               # Temporary files
```

## 🔄 Quy trình hoạt động

1. **Runner01** khởi động → Join Tailscale → Chạy 55 phút → Dữ liệu được lưu trong `.runner-data/`
2. **Runner02** bắt đầu:
   - Join Tailscale network
   - Detect Runner01 (cùng tag, đang active)
   - Pull `.runner-data/` từ Runner01
   - Stop services trên Runner01 (cloudflared, pocketbase, etc.)
   - Chạy services trên Runner02
   - Push `.runner-data/` lên git repository
3. **Runner01** → **Runner02** xoay vòng liên tục

## 🎯 Use Cases

### GitHub Actions

```yaml
- name: Setup Tailscale Sync
  env:
    TAILSCALE_CLIENT_ID: ${{ secrets.TAILSCALE_CLIENT_ID }}
    TAILSCALE_CLIENT_SECRET: ${{ secrets.TAILSCALE_CLIENT_SECRET }}
    TAILSCALE_ENABLE: 1
  run: |
    npm install -g runner-tailscale-sync
    runner-sync
```

### Azure DevOps

```yaml
- script: |
    npm install -g runner-tailscale-sync
    runner-sync
  env:
    TAILSCALE_CLIENT_ID: $(TAILSCALE_CLIENT_ID)
    TAILSCALE_CLIENT_SECRET: $(TAILSCALE_CLIENT_SECRET)
    TAILSCALE_ENABLE: 1
  displayName: "Sync Runner Data"
```

### Self-hosted Runner

```bash
# Install
npm install -g runner-tailscale-sync

# Add to runner startup script
export TAILSCALE_ENABLE=1
export TAILSCALE_CLIENT_ID=your_client_id
export TAILSCALE_CLIENT_SECRET=your_secret

runner-sync
```

## 🛠️ Development

### Scripts

```bash
# Generate new version (VN timezone: 1.yyMMdd.1HHmm)
npm run version

# Build validation
npm run build

# Publish to npm
npm run publish

# Dry run publish
node scripts/publish.js --dry-run
```

### Testing Locally

```bash
# Link globally
npm link

# Test CLI
runner-sync --help
runner-sync status

# Test as library
node -e "require('./src/index.js').status().then(console.log)"
```

## 📝 Version Format

Version theo giờ Việt Nam (UTC+7): `1.yyMMdd.1HHmm`

Ví dụ:

- Build lúc 15:30 ngày 02/02/2025 → `1.250202.11530`
- Build lúc 09:45 ngày 15/03/2025 → `1.250315.10945`

Đảm bảo semver compliance và tự động tăng theo thời gian.

## 🔧 Yêu cầu hệ thống

- Node.js >= 20
- Git (cho tính năng push)
- Tailscale (sẽ tự động cài trên Linux)
- rsync hoặc scp (cho data sync)

### Windows

Trên Windows, cần cài thêm:

- [Tailscale for Windows](https://tailscale.com/download/windows)
- Git for Windows (có sẵn ssh/scp)
- Hoặc cài rsync qua: `choco install rsync` hoặc WSL

Cấu hình đường dẫn trong `.env`:

```env
SSH_PATH=C:\Program Files\Git\usr\bin\ssh.exe
RSYNC_PATH=C:\Program Files\rsync\rsync.exe
```

## 🐛 Troubleshooting

### Tailscale không kết nối được

```bash
# Kiểm tra Tailscale status
tailscale status

# Login manually
tailscale login

# Check logs
runner-sync status -v
```

### Sync thất bại

```bash
# Kiểm tra SSH connection
ssh runner01-ip echo "OK"

# Test rsync
rsync -avz runner01-ip:.runner-data/ .runner-data/

# Verbose mode
runner-sync -v
```

### Git push bị conflict

```bash
# Pull latest trước
cd /path/to/repo
git pull origin main

# Hoặc disable git push
export GIT_PUSH_ENABLED=0
runner-sync
```

## 📄 License

MIT

## 🤝 Contributing

Pull requests are welcome!

## 📧 Support

- Issues: [GitHub Issues](https://github.com/yourname/runner-tailscale-sync/issues)
- Email: your-email@example.com
