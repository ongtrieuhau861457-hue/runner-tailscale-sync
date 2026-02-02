# Architecture Documentation

## 📐 Tổng quan kiến trúc

Package `runner-tailscale-sync` được thiết kế theo Domain-Driven Architecture với separation of concerns rõ ràng.

## 🏗️ Layers

### 1. Core Layer (`src/core/`)

Chứa business logic thuần túy, không phụ thuộc vào infrastructure.

- **sync-orchestrator.js**: Điều phối toàn bộ workflow
  - parseInput() → validate() → plan() → execute() → report()
  - Quản lý thứ tự các bước: setup → tailscale → detect → pull → stop → push

- **runner-detector.js**: Phát hiện runner trước đó
  - Scan Tailscale peers với cùng tag
  - Lọc peer đang online, không phải chính mình
  - Return peer info (IP, hostname, DNS)

- **data-sync.js**: Đồng bộ .runner-data
  - Pull data từ remote runner qua rsync/scp
  - Fallback mechanism: rsync → scp
  - Report synced size

- **service-controller.js**: Quản lý services
  - Stop services trên remote runner qua SSH
  - Fallback: systemctl → pkill
  - Non-blocking nếu SSH fail

- **init.js**: Khởi tạo runner
  - Setup .runner-data directories
  - Connect Tailscale + detect runner trước đó
  - Pipeline parse → validate → plan → execute → report

- **push.js**: Push dữ liệu lên git
  - Validate git availability + repo
  - Commit/push .runner-data
  - Pipeline parse → validate → plan → execute → report

- **status.js**: Báo trạng thái
  - Show Tailscale status + peers
  - Report .runner-data size
  - Pipeline parse → validate → plan → execute → report

### 2. Adapter Layer (`src/adapters/`)

Tương tác với external systems và OS.

- **tailscale.js**: Tailscale operations
  - install(), login(), getStatus()
  - findPeersWithTag()
  - Platform-specific commands (Linux/Windows/macOS)

- **git.js**: Git operations
  - add(), commit(), push(), pull()
  - Retry mechanism cho network errors
  - Conflict detection

- **ssh.js**: SSH operations
  - executeCommand(), stopServices()
  - Connection check
  - Timeout handling

- **fs.js**: File system operations
  - Atomic writes (write to .tmp → rename)
  - ensureDir(), readJson(), writeJson()
  - getDirSize(), formatBytes()

- **process.js**: Process spawning
  - Cross-platform command execution
  - runWithTimeout()
  - commandExists()

- **http.js**: HTTP adapter
  - fetchWithTimeout()
  - fetchWithRetry()

### 3. CLI Layer (`src/cli/`)

Command-line interface.

- **parser.js**: Argument parsing
  - Không dùng thư viện external
  - Parse commands: init, sync, push, status
  - Parse flags: --cwd, --verbose, --quiet

- **commands/**: Command implementations
  - Mỗi command = 1 file
  - run(config, logger) interface
  - Gọi core modules để thực hiện

### 4. Utils Layer (`src/utils/`)

Tiện ích dùng chung.

- **logger.js**: Logging với masking
  - Tự động mask sensitive env vars
  - Version và timestamp trong mọi log
  - Levels: info, success, warn, error, debug

- **time.js**: Vietnam timezone
  - getVietnamTime() (UTC+7)
  - generateVersion(): 1.yyMMdd.1HHmm
  - getTimestamp() cho logs

- **config.js**: Configuration management
  - Load từ: .env → env vars → CLI flags
  - Priority: CLI flags > env > defaults
  - validate() để check required fields

- **errors.js**: Custom errors
  - ValidationError (exit 2)
  - NetworkError (exit 10)
  - ProcessError (exit 20)
  - SyncError (exit 20)

- **constants.js**: Hằng số
  - Exit codes, timeouts, paths

## 🔄 Data Flow

```
CLI Entry (bin/runner-sync.js)
    ↓
Parser (parseArgs)
    ↓
Config + Logger creation
    ↓
Command Module (cli/commands/*.js)
    ↓
Core Module (core/*.js)
    ↓ (calls)
Adapters (adapters/*.js)
    ↓ (calls)
External Systems (Tailscale, Git, SSH, FS)
```

## 📋 Step-by-Step Pipeline

Mọi command đều follow 5-step pipeline:

```javascript
async function run(config, logger) {
  // 1. Parse Input
  const input = parseInput(config, logger);

  // 2. Validate
  const errors = validate(input);
  if (errors.length > 0) throw new Error(...);

  // 3. Plan
  const plan = plan(input);

  // 4. Execute
  const result = await execute(plan, input);

  // 5. Report
  return report(result, input);
}
```

## 🗂️ Directory Structure Logic

```
.runner-data/           # Tất cả data của runner
├── logs/              # Application logs
├── pid/               # Process ID files
├── data-services/     # Service-specific data
└── tmp/               # Temporary files
```

- **Nguyên tắc**: Không ghi file ra ngoài .runner-data/
- **CWD configurable**: --cwd flag > TOOL_CWD env > process.cwd()
- **Atomic writes**: Write to .tmp → rename

## 🔐 Security

### Sensitive Data Masking

Logger tự động mask:
- Password, secret, key, token, API keys
- Client IDs, OAuth credentials
- Bỏ qua: common values (true/false/null), số thuần

### SSH Key Management

- Sử dụng StrictHostKeyChecking=no (chỉ trong CI)
- Timeout cho SSH connections (60s)
- Non-blocking nếu connection fail

## 🌐 Cross-Platform Support

### Linux
- Auto-install Tailscale qua curl script
- Use sudo cho tailscale, systemctl
- SSH enabled by default

### Windows
- Manual install Tailscale
- Không dùng sudo
- SSH path configurable: SSH_PATH env
- No --ssh flag cho Tailscale

### macOS
- Manual install qua brew
- Cảnh báo user install manually

## 🔄 Error Recovery

### Network Errors
- Retry mechanism: 3 attempts với 2s delay
- Git push/pull retry
- Fallback: rsync → scp

### Missing Dependencies
- Check commandExists() trước khi dùng
- Clear error messages với install instructions
- Graceful degradation (ví dụ: skip git push nếu not a repo)

## 📊 Logging Strategy

### Version Tracking
Mọi log có prefix: `[package@version] [timestamp]`

### Masking
Auto-mask sensitive env vars trong logs

### Levels
- info: Normal operations
- success: Completed steps
- warn: Recoverable errors
- error: Fatal errors
- debug: Verbose mode only

## 🧪 Testing Strategy (không implement mặc định)

### Cách bật testing:
```bash
npm install --save-dev vitest
# or
npm install --save-dev node:test
```

### Test structure:
```
tests/
├── unit/
│   ├── core/
│   ├── adapters/
│   └── utils/
├── integration/
└── e2e/
```

## 📦 Build & Release

### Versioning
- Format: 1.yyMMdd.1HHmm (Vietnam time)
- Semver compliant
- Auto-increment theo thời gian

### Build Process
1. Validate structure
2. Set executable permissions
3. Test require
4. Ready for publish

### Publish
1. Run build
2. Check version not exists
3. npm publish
4. Tag git commit

## 🔧 Extension Points

### Adding New Commands
1. Create `src/cli/commands/mycommand.js`
2. Export `{ run(config, logger) }`
3. Add to `bin/runner-sync.js` switch case

### Adding New Adapters
1. Create `src/adapters/myadapter.js`
2. Export functions
3. Use in core modules

### Adding New Core Logic
1. Create `src/core/mymodule.js`
2. Follow 5-step pipeline
3. Export main function

## 📚 Dependencies Philosophy

- **Runtime deps**: 0 (zero external dependencies)
- **Why**: Tối ưu size, security, compatibility
- **Trade-off**: Tự implement argument parser, logger, etc.
- **When to add**: Chỉ khi thật sự cần (ví dụ: crypto libs)

## 🎯 Design Principles

1. **Separation of Concerns**: Core ≠ Adapters ≠ CLI
2. **Dependency Inversion**: Core không biết Adapters
3. **Single Responsibility**: Mỗi module có 1 nhiệm vụ
4. **Pipeline Pattern**: parseInput → validate → plan → execute → report
5. **Fail-Safe**: Graceful degradation, clear errors
6. **Cross-Platform**: Linux first, Windows support
7. **Zero Dependencies**: Tự implement utilities
8. **Logging Everything**: Version, timestamp, masking
