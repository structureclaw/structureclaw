param(
  [int]$MinMajor = 20,
  [string]$TargetNodeVersion = "24",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-NodeMajor {
  param([string]$VersionText)
  if ($VersionText -match '^v(?<major>\d+)') {
    return [int]$Matches.major
  }
  throw "Unable to parse Node.js version: $VersionText"
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeVersion = node -v
  $major = Get-NodeMajor -VersionText $nodeVersion
  if ($major -ge $MinMajor) {
    Write-Host "Node.js is already installed (>= $MinMajor): $nodeVersion"
    Write-Host "Node.js 已安装且版本满足要求 (>= $MinMajor)：$nodeVersion"
    exit 0
  }
  Write-Host "Detected Node.js $nodeVersion, but version >= $MinMajor is required."
  Write-Host "检测到 Node.js $nodeVersion，但要求版本 >= $MinMajor。"
}

if ($DryRun) {
  Write-Host "[dry-run] Would install nvm-windows and Node.js $TargetNodeVersion."
  Write-Host "[dry-run] 将安装 nvm-windows 和 Node.js $TargetNodeVersion。"
  exit 0
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "winget is required but not found. Install App Installer from Microsoft Store."
  Write-Host "未找到 winget。请先从 Microsoft Store 安装 App Installer。"
  exit 1
}

Write-Host "Installing nvm-windows with winget..."
Write-Host "正在通过 winget 安装 nvm-windows..."
winget install -e --id CoreyButler.NVMforWindows --accept-source-agreements --accept-package-agreements
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed to install nvm-windows via winget (exit code: $LASTEXITCODE)."
  Write-Host "通过 winget 安装 nvm-windows 失败（退出码：$LASTEXITCODE）。"
  exit $LASTEXITCODE
}

$nvmExe = "$env:ProgramFiles\nvm\nvm.exe"
if (-not (Test-Path $nvmExe)) {
  $nvmExe = "$env:LOCALAPPDATA\Programs\nvm\nvm.exe"
}
if (-not (Test-Path $nvmExe)) {
  Write-Host "nvm-windows install completed, but nvm.exe was not found."
  Write-Host "nvm-windows 安装完成，但未找到 nvm.exe。"
  Write-Host "Please open a new PowerShell window and rerun this script."
  Write-Host "请打开新的 PowerShell 窗口后重新运行脚本。"
  exit 1
}

Write-Host "Installing Node.js $TargetNodeVersion via nvm..."
Write-Host "通过 nvm 安装 Node.js $TargetNodeVersion..."
& $nvmExe install $TargetNodeVersion
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed to install Node.js $TargetNodeVersion via nvm (exit code: $LASTEXITCODE)."
  Write-Host "通过 nvm 安装 Node.js $TargetNodeVersion 失败（退出码：$LASTEXITCODE）。"
  exit $LASTEXITCODE
}
& $nvmExe use $TargetNodeVersion
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed to activate Node.js $TargetNodeVersion via nvm (exit code: $LASTEXITCODE)."
  Write-Host "通过 nvm 切换到 Node.js $TargetNodeVersion 失败（退出码：$LASTEXITCODE）。"
  exit $LASTEXITCODE
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host "Done. Current Node.js version: $(node -v)"
  Write-Host "完成。当前 Node.js 版本：$(node -v)"
} else {
  Write-Host "Installation completed. Please open a new terminal and run ""node -v""."
  Write-Host "安装已完成。请打开新的终端并运行 ""node -v""。"
}
