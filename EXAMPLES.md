# Examples - Ví dụ sử dụng

## 📋 Mục lục

1. [CLI Examples](#cli-examples)
2. [Library Examples](#library-examples)
3. [GitHub Actions Examples](#github-actions-examples)
4. [Azure DevOps Examples](#azure-devops-examples)
5. [Advanced Use Cases](#advanced-use-cases)

---

## CLI Examples

### 1. Full sync với Tailscale

```bash
# Setup environment
export TAILSCALE_CLIENT_ID=tskey-client-xxxxx
export TAILSCALE_CLIENT_SECRET=tskey-xxxxx
export TAILSCALE_ENABLE=1

# Run full sync
runner-sync
```

Output:
```
[250202-153045] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[250202-153045] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ 📦 runner-tailscale-sync - version 1.250202.11530
[250202-153045] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ 🧾 Đang thực thi version: 1.250202.11530
[250202-153045] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ 🎯 Command: sync
[250202-153045] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ 🕐 Started at: 250202-153045 (VN Time)
[250202-153045] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[250202-153046] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ Starting full synchronization...
[250202-153046] [runner-tailscale-sync@1.250202.11530] [sync] ℹ️ ━━━ Step: setup_directories ━━━
[250202-153046] [runner-tailscale-sync@1.250202.11530] [sync] ✅ Created 5 directories
...
```

### 2. Chỉ khởi tạo Tailscale

```bash
runner-sync init
```

### 3. Chỉ push git

```bash
runner-sync push
```

### 4. Xem status

```bash
runner-sync status
```

Output:
```
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ ━━━ Tailscale Status ━━━
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ Backend: Running
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ Hostname: runner-01
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ DNS: runner-01.tail-scale.ts.net
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ IPs: 100.64.0.1
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ Peers: 1 connected
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ Peers with tag 'tag:ci':
[250202-153045] [runner-tailscale-sync@1.250202.11530] [status] ℹ️   1. runner-02 (100.64.0.2)
[250202-153046] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ ━━━ Runner Data ━━━
[250202-153046] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ Directory: /home/runner/work/project/.runner-data
[250202-153046] [runner-tailscale-sync@1.250202.11530] [status] ℹ️ Size: 45.23 MB
```

### 5. Custom working directory

```bash
runner-sync --cwd /path/to/project
```

### 6. Verbose mode

```bash
runner-sync -v
```

### 7. Quiet mode (chỉ errors)

```bash
runner-sync -q
```

---

## Library Examples

### 1. Basic sync

```javascript
const runnerSync = require('runner-tailscale-sync');

(async () => {
  try {
    const result = await runnerSync.sync({
      cwd: '/home/runner/work/project',
      verbose: true,
    });

    console.log('Sync completed:', result);
  } catch (err) {
    console.error('Sync failed:', err.message);
    process.exit(1);
  }
})();
```

### 2. Step-by-step control

```javascript
const runnerSync = require('runner-tailscale-sync');

(async () => {
  // Step 1: Init only
  const initResult = await runnerSync.init({ verbose: true });
  console.log('Tailscale IP:', initResult.tailscale?.ip);

  // Step 2: Your custom logic here
  // ...

  // Step 3: Push to git
  await runnerSync.push();
})();
```

### 3. Sử dụng modules riêng lẻ

```javascript
const { 
  Config, 
  Logger, 
  runnerDetector,
  dataSync,
  serviceController 
} = require('runner-tailscale-sync');

(async () => {
  // Create config và logger
  const config = new Config({ 
    cwd: process.cwd(),
    verbose: true 
  });

  const logger = new Logger({
    packageName: 'my-custom-tool',
    version: '1.0.0',
    command: 'custom-sync',
    verbose: true,
  });

  logger.printBanner();

  // Detect previous runner
  const detection = await runnerDetector.detectPreviousRunner(config, logger);

  if (detection.previousRunner) {
    logger.info(`Found previous runner: ${detection.previousRunner.hostname}`);

    // Pull data
    await dataSync.pullData(config, detection.previousRunner, logger);

    // Stop services
    await serviceController.stopRemoteServices(
      config, 
      detection.previousRunner, 
      logger
    );
  } else {
    logger.info('No previous runner - fresh start');
  }
})();
```

---

## GitHub Actions Examples

### 1. Self-hosted runner với Tailscale

```yaml
name: CI with Runner Sync

on:
  schedule:
    - cron: '*/55 * * * *'  # Every 55 minutes
  workflow_dispatch:

jobs:
  build:
    runs-on: self-hosted
    
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install runner-sync
        run: npm install -g runner-tailscale-sync

      - name: Sync runner data
        env:
          TAILSCALE_CLIENT_ID: ${{ secrets.TAILSCALE_CLIENT_ID }}
          TAILSCALE_CLIENT_SECRET: ${{ secrets.TAILSCALE_CLIENT_SECRET }}
          TAILSCALE_ENABLE: 1
          TAILSCALE_TAGS: tag:ci
          SERVICES_TO_STOP: cloudflared,pocketbase
        run: runner-sync

      - name: Your build steps
        run: |
          npm install
          npm run build
```

### 2. Matrix strategy với multiple runners

```yaml
name: Multi-Runner Sync

on:
  schedule:
    - cron: '0 */1 * * *'

jobs:
  sync:
    runs-on: ${{ matrix.runner }}
    strategy:
      matrix:
        runner: [runner-01, runner-02]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Sync
        env:
          TAILSCALE_CLIENT_ID: ${{ secrets.TAILSCALE_CLIENT_ID }}
          TAILSCALE_CLIENT_SECRET: ${{ secrets.TAILSCALE_CLIENT_SECRET }}
          TAILSCALE_ENABLE: 1
        run: npx runner-tailscale-sync
```

---

## Azure DevOps Examples

### 1. Pipeline với runner sync

```yaml
trigger:
  - main

pool:
  name: 'Self-Hosted Pool'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
    displayName: 'Install Node.js'

  - script: |
      npm install -g runner-tailscale-sync
    displayName: 'Install runner-sync'

  - script: |
      runner-sync
    env:
      TAILSCALE_CLIENT_ID: $(TAILSCALE_CLIENT_ID)
      TAILSCALE_CLIENT_SECRET: $(TAILSCALE_CLIENT_SECRET)
      TAILSCALE_ENABLE: 1
      SERVICES_TO_STOP: cloudflared,pocketbase,http-server
    displayName: 'Sync runner data'

  - script: |
      npm install
      npm run build
    displayName: 'Build'
```

### 2. Scheduled pipeline

```yaml
schedules:
  - cron: "*/55 * * * *"
    displayName: Hourly runner rotation
    branches:
      include:
        - main

steps:
  - script: npx runner-tailscale-sync
    env:
      TAILSCALE_CLIENT_ID: $(TAILSCALE_CLIENT_ID)
      TAILSCALE_CLIENT_SECRET: $(TAILSCALE_CLIENT_SECRET)
      TAILSCALE_ENABLE: 1
    displayName: 'Rotate runners'
```

---

## Advanced Use Cases

### 1. Custom service stop commands

```javascript
const { ssh, Config, Logger } = require('runner-tailscale-sync');

const config = new Config();
const logger = new Logger({ packageName: 'custom', version: '1.0.0' });

// Custom stop logic
async function stopCustomServices(remoteHost) {
  // Stop Docker containers
  await ssh.executeCommand(
    remoteHost,
    'docker stop $(docker ps -q)',
    { logger }
  );

  // Stop custom service
  await ssh.executeCommand(
    remoteHost,
    'systemctl stop my-custom-service',
    { logger }
  );

  // Kill specific process
  await ssh.executeCommand(
    remoteHost,
    'pkill -f "my-app"',
    { logger }
  );
}

// Use in workflow
(async () => {
  const detection = await runnerDetector.detectPreviousRunner(config, logger);
  
  if (detection.previousRunner) {
    await stopCustomServices(detection.previousRunner.ips[0]);
  }
})();
```

### 2. Selective sync (chỉ sync một số thư mục)

```javascript
const { process_adapter, Config, Logger } = require('runner-tailscale-sync');

async function selectiveSync(remoteHost, localDir) {
  const logger = new Logger({ packageName: 'selective-sync', version: '1.0.0' });

  // Chỉ sync logs và data-services
  const dirs = ['logs', 'data-services'];

  for (const dir of dirs) {
    const rsyncCmd = `rsync -avz ${remoteHost}:.runner-data/${dir}/ ${localDir}/${dir}/`;
    
    logger.info(`Syncing ${dir}...`);
    await process_adapter.runWithTimeout(rsyncCmd, 300000, { logger });
  }

  logger.success('Selective sync completed');
}
```

### 3. Pre/Post sync hooks

```javascript
const runnerSync = require('runner-tailscale-sync');
const { execSync } = require('child_process');

async function syncWithHooks() {
  // Pre-sync hook
  console.log('Running pre-sync hook...');
  execSync('docker-compose down');

  // Main sync
  await runnerSync.sync({ verbose: true });

  // Post-sync hook
  console.log('Running post-sync hook...');
  execSync('docker-compose up -d');
  execSync('npm run migrate');
}

syncWithHooks().catch(console.error);
```

### 4. Monitoring và alerting

```javascript
const runnerSync = require('runner-tailscale-sync');

async function syncWithMonitoring() {
  const startTime = Date.now();

  try {
    const result = await runnerSync.sync({ verbose: false });

    const duration = Date.now() - startTime;

    // Send metrics to monitoring system
    await fetch('https://metrics.example.com/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metric: 'runner_sync_duration',
        value: duration,
        tags: { status: 'success' },
      }),
    });

    console.log(`Sync completed in ${duration}ms`);
  } catch (err) {
    // Alert on failure
    await fetch('https://alerts.example.com/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Runner sync failed',
        message: err.message,
        severity: 'critical',
      }),
    });

    throw err;
  }
}
```

### 5. Conditional sync based on runner load

```javascript
const runnerSync = require('runner-tailscale-sync');
const os = require('os');

async function smartSync() {
  // Check system load
  const loadAvg = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const loadPercent = (loadAvg / cpuCount) * 100;

  if (loadPercent > 80) {
    console.log('System load too high, skipping sync');
    return;
  }

  // Check disk space
  const { execSync } = require('child_process');
  const dfOutput = execSync('df -h .').toString();
  // Parse and check available space

  // Proceed with sync
  await runnerSync.sync();
}
```

---

## 🔧 Troubleshooting Examples

### Debug mode

```bash
# Maximum verbosity
runner-sync -v 2>&1 | tee sync.log
```

### Test connectivity

```bash
# Test Tailscale
runner-sync status

# Test SSH
ssh runner-01-ip echo "OK"

# Test rsync
rsync -avz runner-01-ip:.runner-data/ test-sync/
```

### Manual recovery

```bash
# If sync fails, manual steps:

# 1. Pull data manually
rsync -avz runner-01-ip:.runner-data/ .runner-data/

# 2. Stop services manually
ssh runner-01-ip "sudo systemctl stop cloudflared"
ssh runner-01-ip "sudo systemctl stop pocketbase"

# 3. Push to git
git add .runner-data/
git commit -m "Manual sync"
git push
```

---

## 📚 More Resources

- [Architecture Documentation](./ARCHITECTURE.md)
- [README](./README.md)
- [GitHub Examples](https://github.com/yourname/runner-tailscale-sync/tree/main/examples)
