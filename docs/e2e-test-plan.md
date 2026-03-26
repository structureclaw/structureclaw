# StructureClaw 端到端测试方案

## 目标

在空白 Windows 系统上验证 `sclaw` 提供的 Docker 安装、启动、停止命令的完整功能。

---

## 方案 1: GitHub Actions Windows Runner（推荐）

### 优点
- 完全免费的 Windows 环境
- 每次 CI 都是全新系统
- 可自动化执行
- 支持测试矩阵（不同 Windows 版本）

### 实现步骤

1. 创建 `.github/workflows/test-installer.yml`:

```yaml
name: Test Windows Installer

on:
  push:
    paths:
      - 'sclaw'
      - 'package.json'
      - 'scripts/cli/**'
      - 'docker-compose.yml'
      - '.github/workflows/test-installer.yml'
  pull_request:
    paths:
      - 'sclaw'
      - 'package.json'
      - 'scripts/cli/**'
      - 'docker-compose.yml'

jobs:
  test-installer:
    runs-on: windows-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Test Docker detection
        shell: powershell
        run: |
          . ./test-installer.ps1

      - name: Test docker bootstrap command
        shell: powershell
        run: |
          node .\sclaw docker-install --non-interactive --llm-provider openai --llm-base-url https://api.openai.com/v1 --llm-api-key test-key --llm-model gpt-4.1 --skip-api-test
```

### 限制
- GitHub Actions Windows runner 已预装 Docker Desktop
- 无法测试"未安装 Docker"的场景

---

## 方案 2: Windows Sandbox（本地测试）

### 优点
- 轻量级，每次都是干净环境
- 支持 Windows 10/11 Pro/Enterprise
- 可以完全控制安装过程

### 实现步骤

1. 创建 `test-sandbox.wsb` 配置文件:

```xml
<Configuration>
  <VGpu>Enable</VGpu>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>D:\Code\参与的项目\structureclaw</HostFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -ExecutionPolicy Bypass -File C:\Users\WDAGUtilityAccount\Desktop\structureclaw\test-installer.ps1</Command>
  </LogonCommand>
</Configuration>
```

2. 运行测试:
```powershell
# 启动 Windows Sandbox
Start-Process "test-sandbox.wsb"
```

### 限制
- 需要 Windows Pro/Enterprise
- 需要在 BIOS 中启用虚拟化
- 无法预装 Docker（需要手动安装）

---

## 方案 3: Hyper-V 虚拟机（完整测试）

### 优点
- 完全控制测试环境
- 可以测试所有场景（包括无 Docker）
- 可以创建快照回滚

### 实现步骤

1. 创建 Windows 11 VM 模板
2. 安装 PowerShell 7
3. 创建测试脚本:

```powershell
# test-vm.ps1
param(
  [string]$VMName = "StructureClaw-Test",
  [string]$VMSwitch = "Default Switch"
)

# 创建检查点
Checkpoint-VM -Name $VMName -SnapshotName "BeforeTest"

# 复制测试文件到 VM
Copy-VMFile -Name $VMName -SourcePath ".\sclaw" -DestinationPath "C:\Test\" -CreateFullPath

# 在 VM 中执行测试
Invoke-Command -VMName $VMName -ScriptBlock {
  Set-Location C:\Test
  node .\sclaw docker-install --non-interactive --llm-provider openai --llm-base-url https://api.openai.com/v1 --llm-api-key test-key --llm-model gpt-4.1 --skip-api-test
}

# 恢复检查点
Restore-VMSnapshot -VMName $VMName -Name "BeforeTest"
```

---

## 方案 4: Node CLI 单元测试（代码层面）

### 优点
- 快速执行
- 可以模拟各种场景
- 集成到 CI/CD

### 实现步骤

创建 `scripts/cli/main.test.js` 或额外的 CLI 测试文件：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('docker commands are exposed through sclaw', async () => {
  const { COMMAND_NAMES } = require('../../scripts/cli/command-manifest.js');
  assert.equal(COMMAND_NAMES.has('docker-install'), true);
  assert.equal(COMMAND_NAMES.has('docker-start'), true);
  assert.equal(COMMAND_NAMES.has('docker-stop'), true);
});
```

---

## 推荐的组合策略

| 测试类型 | 工具 | 触发条件 | 目的 |
|---------|------|---------|------|
| 单元测试 | Node test | 每次 commit | 验证 CLI 命令与参数逻辑 |
| 集成测试 | GitHub Actions | PR / Push | 验证 Docker 环境 |
| 端到端测试 | Windows Sandbox | 发布前 | 完整用户体验 |

---

## 下一步行动

1. 创建 `.github/workflows/test-installer.yml`
2. 为 `scripts/cli` 增补更多 Docker 命令测试
3. 创建 `test-sandbox.wsb` 配置文件
4. 编写测试文档 `tests/README.md`
