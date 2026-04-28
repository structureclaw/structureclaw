# StructureClaw 端到端测试方案

## 目标

在干净环境（含 Windows）上验证安装与 `sclaw` / `sclaw_cn` 相关流程是否可用。

---

## 方案 1: GitHub Actions（推荐，与仓库 CI 一致）

仓库通过 [`.github/workflows/install-smoke.yml`](../.github/workflows/install-smoke.yml) 在 CI 中执行：

- **`smoke-native`**：`node tests/runner.mjs smoke-native`（Ubuntu 与 `windows-latest` 矩阵，等价 `npm ci` + 构建）。

与本地/文档对齐的命令：

```bash
node tests/runner.mjs smoke-native
```

根目录 `package.json` 也提供别名：`npm run smoke:native`。

---

## 方案 2: Windows Sandbox（本地测试）

### 优点

- 轻量级，每次都是干净环境
- 支持 Windows 10/11 Pro/Enterprise
- 可以完全控制安装过程

### 实现步骤

1. 创建 `test-sandbox.wsb`，将仓库映射进沙箱（按需修改 `HostFolder`）。
2. 在沙箱内克隆或映射代码后，在 PowerShell 中执行与 CI 相同的校验，例如：

```powershell
Set-Location C:\path\to\structureclaw
node tests\runner.mjs smoke-native
```

### 限制

- 需要 Windows Pro/Enterprise
- 需要在 BIOS 中启用虚拟化

---

## 方案 3: Hyper-V 虚拟机（完整测试）

### 优点

- 完全控制测试环境
- 可以测试所有场景
- 可以创建快照回滚

### 实现步骤

1. 创建 Windows 11 VM 模板
2. 安装 PowerShell 7 与 Node.js
3. 在 VM 内执行与方案 1 相同的 `node tests/runner.mjs smoke-native`：

```powershell
# test-vm.ps1（示例片段）
param(
  [string]$VMName = "StructureClaw-Test"
)

Checkpoint-VM -Name $VMName -SnapshotName "BeforeTest"
# … 将仓库同步到 VM 后 …
Invoke-Command -VMName $VMName -ScriptBlock {
  Set-Location C:\Test
  node tests\runner.mjs smoke-native
}
Restore-VMSnapshot -VMName $VMName -Name "BeforeTest"
```

---

## 方案 4: 回归与契约校验（代码层面）

CLI 与后端的深度校验通过 `tests/runner.mjs` 完成，例如：

```bash
node tests/runner.mjs analysis-regression
node tests/runner.mjs check backend-regression
node tests/runner.mjs validate --list
```

详见根目录 [AGENTS.md](../AGENTS.md) 中的 **Build, Run, and Verify**。

---

## 推荐的组合策略

| 测试类型 | 工具 | 触发条件 | 目的 |
|---------|------|---------|------|
| 安装与构建冒烟 | `install-smoke.yml` / `smoke-native` | PR / Push（路径触发） | 验证多平台 `npm ci` + 构建 |
| 回归与契约 | `tests/runner.mjs` | 本地或对应 workflow | 分析运行时、API 契约等 |
| 端到端（可选） | Windows Sandbox / Hyper-V | 发布前或重大安装改动 | 接近真实用户环境 |

---

## 下一步行动（可选）

1. 需要时补充 `tests/README.md` 或本仓库其它文档中的 smoke 与回归入口说明。
