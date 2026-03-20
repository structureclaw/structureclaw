# StructureClaw 端到端测试方案

## 目标

在空白 Windows 系统上验证 `install.ps1`、`start.ps1`、`stop.ps1` 脚本的完整功能。

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
      - 'install.ps1'
      - 'start.ps1'
      - 'stop.ps1'
      - '.github/workflows/test-installer.yml'
  pull_request:
    paths:
      - 'install.ps1'
      - 'start.ps1'
      - 'stop.ps1'

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

      - name: Test install script (dry-run)
        shell: powershell
        run: |
          # 模拟用户输入测试
          $inputs = @"
openai
https://api.openai.com/v1
test-key
gpt-4-turbo-preview
"@
          # 注意：GitHub Actions 的 Windows runner 已预装 Docker
          # 但可能需要启动服务
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
Copy-VMFile -Name $VMName -SourcePath ".\install.ps1" -DestinationPath "C:\Test\" -CreateFullPath

# 在 VM 中执行测试
Invoke-Command -VMName $VMName -ScriptBlock {
  Set-Location C:\Test
  .\test-installer.ps1
}

# 恢复检查点
Restore-VMSnapshot -VMName $VMName -Name "BeforeTest"
```

---

## 方案 4: Pester 单元测试（代码层面）

### 优点
- 快速执行
- 可以模拟各种场景
- 集成到 CI/CD

### 实现步骤

创建 `tests/install.Tests.ps1`:

```powershell
Describe "StructureClaw Installer Tests" {
  BeforeAll {
    . $PSScriptRoot\..\install.ps1 -DryRun
  }

  Context "Docker Detection" {
    It "Should detect Docker installation" {
      Test-DockerInstalled | Should -Be $true
    }

    It "Should detect Docker service" {
      Test-DockerRunning | Should -Be $true
    }
  }

  Context "Environment File Generation" {
    It "Should generate valid .env file" {
      $envFile = Join-Path $TestDrive ".env"
      New-EnvFile -TemplatePath ".env.example" -OutputPath $envFile `
        -BaseUrl "https://api.test.com/v1" -ApiKey "test-key" -Model "test-model" -Provider "openai"

      $envFile | Should -Exist
      $content = Get-Content $envFile
      $content | Should -Match "LLM_PROVIDER=openai"
    }
  }
}
```

---

## 推荐的组合策略

| 测试类型 | 工具 | 触发条件 | 目的 |
|---------|------|---------|------|
| 单元测试 | Pester | 每次 commit | 验证函数逻辑 |
| 集成测试 | GitHub Actions | PR / Push | 验证 Docker 环境 |
| 端到端测试 | Windows Sandbox | 发布前 | 完整用户体验 |

---

## 下一步行动

1. 创建 `.github/workflows/test-installer.yml`
2. 创建 `tests/install.Tests.ps1` Pester 测试
3. 创建 `test-sandbox.wsb` 配置文件
4. 编写测试文档 `tests/README.md`
