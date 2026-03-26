# StructureClaw Windows 安装指南（WSL2 + Ubuntu 22.04）

本指南用于在 Windows 上快速启动本仓库，推荐路径：

1. WSL2
2. Ubuntu 22.04
3. Docker Desktop
4. `./sclaw doctor`
5. `./sclaw start`

## 中文步骤

### 1. 安装 WSL2（Windows）

以管理员身份打开 PowerShell，执行：

```powershell
wsl --install -d Ubuntu-22.04
wsl --set-default-version 2
```

完成后重启 Windows。首次打开 Ubuntu 时，按提示创建 Linux 用户名和密码。

### 2. 在 Ubuntu 22.04 安装基础工具

在 Ubuntu 终端执行：

```bash
sudo apt update
sudo apt install -y git curl wget
```

### 3. 安装并配置 Docker Desktop（Windows）

1. 安装 Docker Desktop for Windows。
2. 打开 Docker Desktop：
   - `Settings -> General` 勾选 `Use the WSL 2 based engine`
   - `Settings -> Resources -> WSL Integration` 打开 Ubuntu-22.04 的集成开关
3. 在 Ubuntu 终端验证：

```bash
docker version
docker compose version
```

如果提示无权限，可执行：

```bash
sudo usermod -aG docker "$USER"
```

然后关闭并重新打开 Ubuntu 终端。

### 4. 拉取仓库并准备环境

```bash
git clone <your-repo-url> structureclaw
cd structureclaw
cp .env.example .env
```

按需编辑 `.env`（例如 LLM 相关配置）。

### 5. 运行健康检查与启动

```bash
./sclaw doctor
./sclaw start
```

说明：

- `./sclaw doctor` 会执行依赖检查和启动前验证。
- 当前仓库已支持在 `doctor` 过程中自动安装 Node.js（通过 Volta），并自动写入 PATH 到常见 shell 配置。

### 6. 运行状态与停止

```bash
./sclaw status
./sclaw logs
./sclaw stop
```

---

## English Steps

### 1. Install WSL2 (Windows)

Open PowerShell as Administrator and run:

```powershell
wsl --install -d Ubuntu-22.04
wsl --set-default-version 2
```

Restart Windows. On first Ubuntu launch, create your Linux username/password.

### 2. Install base tools in Ubuntu 22.04

Run in Ubuntu terminal:

```bash
sudo apt update
sudo apt install -y git curl wget
```

### 3. Install and configure Docker Desktop (Windows)

1. Install Docker Desktop for Windows.
2. In Docker Desktop:
   - `Settings -> General`: enable `Use the WSL 2 based engine`
   - `Settings -> Resources -> WSL Integration`: enable integration for Ubuntu-22.04
3. Verify in Ubuntu terminal:

```bash
docker version
docker compose version
```

If you hit permission issues:

```bash
sudo usermod -aG docker "$USER"
```

Then close and reopen the Ubuntu terminal.

### 4. Clone repository and prepare environment

```bash
git clone <your-repo-url> structureclaw
cd structureclaw
cp .env.example .env
```

Adjust `.env` as needed (for example, LLM settings).

### 5. Run checks and start

```bash
./sclaw doctor
./sclaw start
```

Notes:

- `./sclaw doctor` runs startup checks before launch (including verifying your Node.js setup).
- Node.js is not installed automatically; please install Node.js yourself (manually or via a tool like Volta/nvm) before running `./sclaw doctor`.

### 6. Check status and stop

```bash
./sclaw status
./sclaw logs
./sclaw stop
```
