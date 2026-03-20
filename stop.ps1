<#
.SYNOPSIS
    StructureClaw Stop Script / StructureClaw 停止脚本
.DESCRIPTION
    This script stops all services for the StructureClaw project.
    此脚本停止 StructureClaw 项目的所有服务。
.EXAMPLE
    .\stop.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

function Write-Info {
  param([string]$Message)
  Write-Host "  $Message" -ForegroundColor Gray
}

Write-Host @"

  ____ _                            _     ___
 / ___| |_ _ __ ___ _ __   ___  ___| |_  / _ \ _ __  ___
| |   | __| '__/ _ \ '_ \ / _ \/ __| __|| | | | '_ \/ __|
| |___| |_| | |  __/ | | |  __/ (__| |_ | |_| | |_) \__ \
 \____|\__|_|  \___|_| |_|\___|\___|\__| \___/| .__/|___|
                                               |_|
                Stop Script / 停止脚本

"@ -ForegroundColor Cyan

# Stop services
Write-Step "Stopping Services / 停止服务"
Push-Location $RootDir
try {
  & docker compose stop 2>&1 | ForEach-Object { Write-Host "    $_" }

  if ($LASTEXITCODE -eq 0) {
    Write-Success "Services stopped / 服务已停止"
  }
  else {
    Write-Warning "Warnings occurred while stopping services / 停止服务时出现警告"
    Write-Info "Please check logs / 请检查日志"
  }
}
finally {
  Pop-Location
}

Write-Host @"

  ====================================================================
               Services Stopped / 服务已停止
  ====================================================================

  Restart services / 重启服务:   .\start.ps1
  Remove containers / 移除容器:  docker compose down

  ====================================================================

"@ -ForegroundColor Green
