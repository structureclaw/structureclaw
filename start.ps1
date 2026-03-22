<#
.SYNOPSIS
    StructureClaw One-click Startup Script / StructureClaw 一键启动脚本
.DESCRIPTION
    This script quickly starts all services for the StructureClaw project.
    此脚本快速启动 StructureClaw 项目的所有服务。
.EXAMPLE
    .\start.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $RootDir '.env'

# Color output functions
function Write-Step {
  param([string]$Message)
  Write-Host "`n[$Message]" -ForegroundColor Cyan
}

function Write-Success {
  param([string]$Message)
  Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Warning {
  param([string]$Message)
  Write-Host "  [!] $Message" -ForegroundColor Yellow
}

function Write-Error {
  param([string]$Message)
  Write-Host "  [X] $Message" -ForegroundColor Red
}

function Write-Info {
  param([string]$Message)
  Write-Host "  $Message" -ForegroundColor Gray
}

function Test-DockerRunning {
  try {
    $result = docker version --format '{{.Server.Version}}' 2>$null
    return -not [string]::IsNullOrWhiteSpace($result)
  }
  catch {
    return $false
  }
}

function Start-DockerDesktop {
  $dockerPaths = @(
    "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  )

  foreach ($path in $dockerPaths) {
    if (Test-Path -LiteralPath $path) {
      Start-Process -FilePath $path
      return $true
    }
  }

  return $false
}

function Wait-ForDocker {
  param([int]$TimeoutSeconds = 60)

  $startTime = Get-Date
  $timeout = $startTime.AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $timeout) {
    if (Test-DockerRunning) {
      return $true
    }
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 3
  }

  Write-Host ""
  return $false
}

function Test-HttpEndpoint {
  param(
    [string]$Uri,
    [int]$TimeoutSeconds = 5
  )

  try {
    # Use curl.exe to bypass PowerShell proxy issues
    # Note: Use curl.exe explicitly, not PowerShell alias
    $result = curl.exe -s -o NUL -w "%{http_code}" $Uri --max-time $TimeoutSeconds 2>$null
    return ($result -eq '200')
  }
  catch {
    return $false
  }
}

function Get-EnvPort {
  param(
    [string]$EnvPath,
    [string]$VarName,
    [string]$DefaultPort
  )

  if (Test-Path -LiteralPath $EnvPath) {
    $content = Get-Content -LiteralPath $EnvPath -Raw
    if ($content -match "$VarName=(\d+)") {
      return $matches[1]
    }
  }
  return $DefaultPort
}

function Get-ContainerStatus {
  param([string]$ServiceName)

  try {
    # Docker outputs NDJSON (one JSON per line), parse each line separately
    $jsonOutput = docker compose ps --format json 2>$null
    if ($jsonOutput) {
      $lines = $jsonOutput -split "`n" | Where-Object { $_.Trim() -ne "" }
      foreach ($line in $lines) {
        try {
          $container = $line | ConvertFrom-Json
          if ($container.Service -eq $ServiceName) {
            $state = $container.State
            $health = $container.Health
            if ($health) {
              return "$state ($health)"
            }
            return $state
          }
        }
        catch {
          # Skip invalid JSON lines
        }
      }
    }
  }
  catch {}

  try {
    # Fallback: parse text output
    $textOutput = docker compose ps 2>$null
    $line = $textOutput | Select-String -Pattern $ServiceName
    if ($line) {
      if ($line -match "Up") {
        return "running"
      }
      return "stopped"
    }
  }
  catch {}

  return "not found"
}

function Get-ServiceStatus {
  param([string]$Name, [string]$Url)

  if (Test-HttpEndpoint -Uri $Url) {
    return @{Name = $Name; Status = 'running'; Color = 'Green'}
  }
  else {
    return @{Name = $Name; Status = 'stopped'; Color = 'Red'}
  }
}

function Invoke-DockerCommand {
  param([string]$Command)

  # Use process to avoid stderr being treated as error
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo.FileName = "docker"
  $process.StartInfo.Arguments = "compose $Command"
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.WorkingDirectory = $RootDir

  $null = $process.Start()

  # Read stdout
  while (-not $process.StandardOutput.EndOfStream) {
    $line = $process.StandardOutput.ReadLine()
    if ($line -ne "") {
      Write-Host "    $line" -ForegroundColor Gray
    }
  }

  # Read stderr (Docker progress info)
  while (-not $process.StandardError.EndOfStream) {
    $line = $process.StandardError.ReadLine()
    if ($line -ne "" -and $line -notmatch "Waiting") {
      Write-Host "    $line" -ForegroundColor DarkGray
    }
  }

  $process.WaitForExit()
  return $process.ExitCode
}

# ============================================
# Main Script
# ============================================

Write-Host @"

  ____ _                            _     ___
 / ___| |_ _ __ ___ _ __   ___  ___| |_  / _ \ _ __  ___
| |   | __| '__/ _ \ '_ \ / _ \/ __| __|| | | | '_ \/ __|
| |___| |_| | |  __/ | | |  __/ (__| |_ | |_| | |_) \__ \
 \____|\__|_|  \___|_| |_|\___|\___|\__| \___/| .__/|___|
                                               |_|
                Startup Script / 启动脚本

"@ -ForegroundColor Cyan

# Step 1: Check Docker service
Write-Step "Checking Docker Service / 检查 Docker 服务"
if (Test-DockerRunning) {
  Write-Success "Docker service is running / Docker 服务运行中"
}
else {
  Write-Warning "Docker service is not running, attempting to start... / Docker 服务未运行，正在尝试启动..."

  if (Start-DockerDesktop) {
    Write-Info "Starting Docker Desktop... / 正在启动 Docker Desktop..."
    if (Wait-ForDocker -TimeoutSeconds 60) {
      Write-Success "Docker service started successfully / Docker 服务启动成功"
    }
    else {
      Write-Error "Docker service startup timeout / Docker 服务启动超时"
      Write-Host "  Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
      exit 1
    }
  }
  else {
    Write-Error "Cannot start Docker Desktop / 无法启动 Docker Desktop"
    Write-Host "  Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
    exit 1
  }
}

# Step 2: Check .env file
Write-Step "Checking Configuration File / 检查配置文件"
if (Test-Path -LiteralPath $EnvFile) {
  Write-Success ".env configuration file exists / .env 配置文件存在"
}
else {
  Write-Error ".env configuration file not found / .env 配置文件不存在"
  Write-Host "  Please run .\install.ps1 first to configure the project" -ForegroundColor Yellow
  Write-Host "  请先运行 .\install.ps1 进行安装配置" -ForegroundColor Yellow
  exit 1
}

# Step 3: Start services
Write-Step "Starting Services / 启动服务"
Push-Location $RootDir
try {
  # Check if containers exist
  $containerCount = (docker compose ps -q 2>$null | Measure-Object).Count

  if ($containerCount -gt 0) {
    Write-Info "Existing containers detected, starting... / 检测到已有容器，正在启动..."
    $exitCode = Invoke-DockerCommand -Command "start"
  }
  else {
    Write-Info "Starting services... / 正在启动服务..."
    $exitCode = Invoke-DockerCommand -Command "up -d"
  }

  if ($exitCode -ne 0) {
    Write-Error "Service startup failed / 服务启动失败"
    Write-Host "  Please check the error and run manually / 请检查错误并手动运行: docker compose up -d" -ForegroundColor Yellow
    exit 1
  }
}
finally {
  Pop-Location
}

Write-Success "Service startup command executed / 服务启动命令已执行"

# Step 4: Display service status
Write-Step "Service Status / 服务状态"

# Read ports from .env file
$frontendPort = Get-EnvPort -EnvPath $EnvFile -VarName "FRONTEND_PORT" -DefaultPort "30000"
$backendPort = Get-EnvPort -EnvPath $EnvFile -VarName "PORT" -DefaultPort "30010"

Write-Info "Ports from .env / 端口配置: Frontend=$frontendPort, Backend=$backendPort"
Write-Info "Checking container status... / 检查容器状态..."

# Show container status for debugging
try {
  $containerStatus = docker compose ps 2>$null
  if ($containerStatus) {
    Write-Host ""
    Write-Host "  [Docker Container Status / Docker 容器状态]" -ForegroundColor DarkGray
    $containerStatus | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ""
  }
}
catch {}

Start-Sleep -Seconds 3

$services = @(
  @{Name = 'Frontend'; Url = "http://localhost:$frontendPort"; Port = $frontendPort; Service = 'frontend'},
  @{Name = 'Backend'; Url = "http://localhost:$backendPort/health"; Port = $backendPort; Service = 'backend'}
)

$allRunning = $true

foreach ($service in $services) {
  $containerStatus = Get-ContainerStatus -ServiceName $service.Service
  $httpStatus = Get-ServiceStatus -Name $service.Name -Url $service.Url

  if ($httpStatus.Status -eq 'running') {
    Write-Host ("  {0,-12} {1,-10} http://localhost:{2}" -f $service.Name, $httpStatus.Status, $service.Port) -ForegroundColor $httpStatus.Color
  }
  else {
    Write-Host ("  {0,-12} {1,-10} (container: {2})" -f $service.Name, $httpStatus.Status, $containerStatus) -ForegroundColor $httpStatus.Color
    $allRunning = $false
  }
}

# Step 5: Display completion message
if ($allRunning) {
  Write-Host @"

  ====================================================================
               Services Started / 服务已启动
  ====================================================================

  Frontend:          http://localhost:$frontendPort
  Backend:           http://localhost:$backendPort/health
  Analysis Routes:   http://localhost:$backendPort/analyze

  Stop services / 停止服务:   .\stop.ps1
  View logs / 查看日志:       docker compose logs -f

  ====================================================================

"@ -ForegroundColor Green
}
else {
  # Show recent logs for troubleshooting
  Write-Info "Fetching recent logs for troubleshooting..."
  try {
    $recentLogs = docker compose logs --tail 20 2>$null
    if ($recentLogs) {
      Write-Host ""
      Write-Host "  [Recent Logs / 最近日志]" -ForegroundColor DarkGray
      $recentLogs | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
      Write-Host ""
    }
  }
  catch {}

  Write-Host @"

  ====================================================================
            Some Services Not Ready / 部分服务未就绪
  ====================================================================

  Please wait a moment and refresh, or check logs for troubleshooting:
  请稍等片刻后刷新页面，或查看日志排查问题：
  docker compose logs -f

  ====================================================================

"@ -ForegroundColor Yellow
}
