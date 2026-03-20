<#
.SYNOPSIS
    StructureClaw One-click Installer / StructureClaw 一键安装脚本
.DESCRIPTION
    This script guides users through the installation and configuration of StructureClaw.
    此脚本引导用户完成 StructureClaw 项目的安装配置。
.PARAMETER DockerInstallerPath
    Path to Docker Desktop installer (optional) / Docker Desktop 安装包路径（可选）
.EXAMPLE
    .\install.ps1
    .\install.ps1 -DockerInstallerPath "C:\Downloads\Docker Desktop Installer.exe"
#>

[CmdletBinding()]
param(
  [string]$DockerInstallerPath = ""
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $RootDir '.env'
$EnvExampleFile = Join-Path $RootDir '.env.example'

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

function Write-Progress {
  param([string]$Message)
  Write-Host "  > $Message" -ForegroundColor White
}

function Test-Administrator {
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DockerInstalled {
  $dockerPaths = @(
    "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  )

  foreach ($path in $dockerPaths) {
    if (Test-Path -LiteralPath $path) {
      return $true
    }
  }

  # Also check if docker command is available
  $dockerCmd = Get-Command 'docker' -ErrorAction SilentlyContinue
  if ($dockerCmd) {
    return $true
  }

  return $false
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
      Write-Info "Starting Docker Desktop... / 正在启动 Docker Desktop..."
      Start-Process -FilePath $path
      return $true
    }
  }

  return $false
}

function Wait-ForDocker {
  param([int]$TimeoutSeconds = 120)

  Write-Info "Waiting for Docker to start (max $TimeoutSeconds seconds)... / 等待 Docker 启动（最多 $TimeoutSeconds 秒）..."

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

function Read-SecureInput {
  param([string]$Prompt)

  Write-Host "  $Prompt" -NoNewline -ForegroundColor White
  $secureString = Read-Host -AsSecureString
  $credential = New-Object System.Management.Automation.PSCredential('temp', $secureString)
  return $credential.GetNetworkCredential().Password
}

function New-EnvFile {
  param(
    [string]$TemplatePath,
    [string]$OutputPath,
    [string]$BaseUrl,
    [string]$ApiKey,
    [string]$Model,
    [string]$Provider
  )

  if (-not (Test-Path -LiteralPath $TemplatePath)) {
    throw "Template file not found: $TemplatePath / 模板文件不存在: $TemplatePath"
  }

  $content = Get-Content -LiteralPath $TemplatePath -Raw

  # Replace LLM configuration values
  $content = $content -replace 'LLM_PROVIDER=.*', "LLM_PROVIDER=$Provider"
  $content = $content -replace 'LLM_API_KEY=.*', "LLM_API_KEY=$ApiKey"
  $content = $content -replace 'LLM_MODEL=.*', "LLM_MODEL=$Model"
  $content = $content -replace 'LLM_BASE_URL=.*', "LLM_BASE_URL=$BaseUrl"

  # Also set provider-specific defaults if using openai
  if ($Provider -eq 'openai') {
    $content = $content -replace 'OPENAI_API_KEY=.*', "OPENAI_API_KEY=$ApiKey"
    $content = $content -replace 'OPENAI_MODEL=.*', "OPENAI_MODEL=$Model"
    $content = $content -replace 'OPENAI_BASE_URL=.*', "OPENAI_BASE_URL=$BaseUrl"
  }

  Set-Content -LiteralPath $OutputPath -Value $content -NoNewline
}

function Test-ApiConnection {
  param(
    [string]$BaseUrl,
    [string]$ApiKey,
    [string]$Model,
    [string]$Provider
  )

  Write-Info "Testing API connection to $BaseUrl..."

  try {
    # Build chat completion URL
    $chatUrl = $BaseUrl.TrimEnd('/')
    if (-not $chatUrl.EndsWith('/chat/completions')) {
      $chatUrl = "$chatUrl/chat/completions"
    }

    $headers = @{
      "Content-Type" = "application/json"
    }

    # Add authorization header based on provider
    if ($Provider -eq 'openai') {
      $headers["Authorization"] = "Bearer $ApiKey"
    }
    elseif ($Provider -eq 'deepseek') {
      $headers["Authorization"] = "Bearer $ApiKey"
    }
    else {
      $headers["Authorization"] = "Bearer $ApiKey"
    }

    $body = @{
      model = $Model
      messages = @(@{role = "user"; content = "Hi"})
      max_tokens = 5
    } | ConvertTo-Json -Depth 2

    try {
      $response = Invoke-RestMethod -Uri $chatUrl -Headers $headers -Method Post -Body $body -TimeoutSec 30
      Write-Success "API connection successful / API 连接成功"
      return $true
    }
    catch {
      Write-Warning "API connection test failed / API 连接测试失败: $($_.Exception.Message)"
      return $false
    }
  }
  catch {
    Write-Warning "API connection test failed / API 连接测试失败: $($_.Exception.Message)"
    return $false
  }
}

function Test-HttpEndpoint {
  param(
    [string]$Uri,
    [int]$TimeoutSeconds = 5
  )

  try {
    $null = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec $TimeoutSeconds
    return $true
  }
  catch {
    return $false
  }
}

function Wait-ForServices {
  param([int]$TimeoutSeconds = 180)

  Write-Info "Waiting for services to start (max $TimeoutSeconds seconds)... / 等待服务启动（最多 $TimeoutSeconds 秒）..."

  $startTime = Get-Date
  $timeout = $startTime.AddSeconds($TimeoutSeconds)
  $services = @(
    @{Name = 'Frontend'; Url = 'http://localhost:30000'},
    @{Name = 'Backend'; Url = 'http://localhost:8000/health'},
    @{Name = 'Core'; Url = 'http://localhost:8001/health'}
  )

  $ready = @{}

  while ((Get-Date) -lt $timeout) {
    $allReady = $true

    foreach ($service in $services) {
      if (-not $ready[$service.Name]) {
        if (Test-HttpEndpoint -Uri $service.Url) {
          $ready[$service.Name] = $true
          Write-Success "$($service.Name) ready / 就绪"
        }
        else {
          $allReady = $false
        }
      }
    }

    if ($allReady -and $ready.Count -eq $services.Count) {
      return $true
    }

    Write-Host "." -NoNewline
    Start-Sleep -Seconds 5
  }

  Write-Host ""
  return $false
}

function Invoke-DockerCompose {
  param([string]$Arguments)

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo.FileName = "docker"
  $process.StartInfo.Arguments = "compose $Arguments"
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.WorkingDirectory = $RootDir

  $null = $process.Start()

  # Read output line by line
  while (-not $process.StandardOutput.EndOfStream) {
    $line = $process.StandardOutput.ReadLine()
    if ($line -match "Building|Step|#[0-9]+|DONE|ERROR|WARN") {
      Write-Host "    $line" -ForegroundColor Gray
    }
    elseif ($line -match "Successfully|built|Created|Started") {
      Write-Host "    $line" -ForegroundColor Green
    }
    elseif ($line -ne "") {
      Write-Host "    $line"
    }
  }

  # Read stderr (progress info)
  while (-not $process.StandardError.EndOfStream) {
    $line = $process.StandardError.ReadLine()
    if ($line -match "Building|#[0-9]+") {
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
 \____|\__|_|  \___|_| |_|\___|\___|\__| \___/| .__/|___/
                                               |_|
           One-click Installer / 一键安装脚本

"@ -ForegroundColor Cyan

# Step 1: Check administrator privileges
Write-Step "Checking Privileges / 检查权限"
if (Test-Administrator) {
  Write-Success "Running with administrator privileges / 以管理员权限运行"
}
else {
  Write-Warning "Not running as administrator / 未以管理员权限运行"
  Write-Info "Some operations may require manual confirmation / 某些操作可能需要手动确认"
}

# Step 2: Check Docker Desktop
Write-Step "Checking Docker Desktop / 检查 Docker Desktop"
if (Test-DockerInstalled) {
  Write-Success "Docker Desktop is installed / Docker Desktop 已安装"
}
else {
  Write-Warning "Docker Desktop is not installed / Docker Desktop 未安装"
  Write-Host ""
  Write-Host "  Please install Docker Desktop / 请安装 Docker Desktop:" -ForegroundColor White
  Write-Host "  1. Visit / 访问 https://www.docker.com/products/docker-desktop"
  Write-Host "  2. Download and install Docker Desktop for Windows / 下载并安装 Windows 版本"
  Write-Host "  3. Restart your computer after installation / 安装完成后重启计算机"
  Write-Host "  4. Run this script again / 重新运行此脚本"
  Write-Host ""

  if ($DockerInstallerPath -and (Test-Path -LiteralPath $DockerInstallerPath)) {
    Write-Info "Installer detected, installing... / 检测到安装包，正在安装..."
    Start-Process -FilePath $DockerInstallerPath -Wait
    Write-Info "Installation complete / 安装完成"
    Write-Info "Please restart and run this script again / 请重启后重新运行此脚本"
    exit 0
  }

  Write-Host "  Press any key to exit... / 按任意键退出..." -ForegroundColor Gray
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

# Step 3: Check Docker service
Write-Step "Checking Docker Service / 检查 Docker 服务"
if (Test-DockerRunning) {
  Write-Success "Docker service is running / Docker 服务运行中"
}
else {
  Write-Warning "Docker service is not running / Docker 服务未运行"

  if (Start-DockerDesktop) {
    if (Wait-ForDocker -TimeoutSeconds 120) {
      Write-Success "Docker service started successfully / Docker 服务启动成功"
    }
    else {
      Write-Error "Docker service startup timeout / Docker 服务启动超时"
      Write-Host "  Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
      Write-Host "  请手动启动 Docker Desktop 后重新运行此脚本" -ForegroundColor Yellow
      Write-Host "  Press any key to exit... / 按任意键退出..." -ForegroundColor Gray
      $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
      exit 1
    }
  }
  else {
    Write-Error "Cannot start Docker Desktop / 无法启动 Docker Desktop"
    Write-Host "  Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
    Write-Host "  请手动启动 Docker Desktop 后重新运行此脚本" -ForegroundColor Yellow
    Write-Host "  Press any key to exit... / 按任意键退出..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit 1
  }
}

# Step 4: Collect LLM configuration
Write-Step "Configure LLM Service / 配置 LLM 服务"
Write-Host "  Please enter LLM service configuration / 请输入 LLM 服务配置" -ForegroundColor Gray
Write-Host "  (API Key input will be hidden / API Key 输入时不会显示)" -ForegroundColor Gray
Write-Host ""

$llmProvider = Read-Host "  LLM Provider / 提供商 [openai]"
if ([string]::IsNullOrWhiteSpace($llmProvider)) {
  $llmProvider = 'openai'
}

$llmBaseUrl = Read-Host "  LLM Base URL / API 端点 (e.g. https://api.deepseek.com)"
while ([string]::IsNullOrWhiteSpace($llmBaseUrl)) {
  Write-Warning "LLM Base URL cannot be empty / LLM Base URL 不能为空"
  $llmBaseUrl = Read-Host "  LLM Base URL / API 端点"
}

$llmApiKey = Read-SecureInput "LLM API Key / 密钥: "
while ([string]::IsNullOrWhiteSpace($llmApiKey)) {
  Write-Warning "LLM API Key cannot be empty / LLM API Key 不能为空"
  $llmApiKey = Read-SecureInput "LLM API Key / 密钥: "
}

$llmModel = Read-Host "  LLM Model / 模型 (e.g. deepseek-chat)"
while ([string]::IsNullOrWhiteSpace($llmModel)) {
  Write-Warning "LLM Model cannot be empty / LLM Model 不能为空"
  $llmModel = Read-Host "  LLM Model / 模型"
}

Write-Success "LLM configuration collected / LLM 配置已收集"

# Step 4.5: Test API connection
Write-Step "Testing API Connection / 测试 API 连接"
$apiTestResult = Test-ApiConnection -BaseUrl $llmBaseUrl -ApiKey $llmApiKey -Model $llmModel -Provider $llmProvider
if (-not $apiTestResult) {
  Write-Warning "API test failed, but continuing with installation / API 测试失败，但继续安装"
  Write-Info "You can verify your API settings later / 稍后可以验证 API 设置"
}

# Step 5: Generate .env file
Write-Step "Generating Configuration File / 生成配置文件"
try {
  New-EnvFile -TemplatePath $EnvExampleFile -OutputPath $EnvFile `
    -BaseUrl $llmBaseUrl -ApiKey $llmApiKey -Model $llmModel -Provider $llmProvider
  Write-Success ".env file generated / .env 文件已生成"
}
catch {
  Write-Error "Failed to generate .env file / 生成 .env 文件失败: $_"
  exit 1
}

# Step 6: Build and start services
Write-Step "Building and Starting Services / 构建并启动服务"
Write-Info "Building Docker images / 构建 Docker 镜像..."
Write-Info "This may take a few minutes on first run / 首次运行可能需要几分钟"
Write-Host ""

Push-Location $RootDir
try {
  Write-Progress "Pulling base images... / 拉取基础镜像..."

  # Run docker compose with progress output
  $exitCode = Invoke-DockerCompose -Arguments "up --build -d"

  if ($exitCode -ne 0) {
    Write-Error "Docker Compose startup failed / Docker Compose 启动失败"
    Write-Host "  Please check the error and run manually / 请检查错误并手动运行: docker compose up --build" -ForegroundColor Yellow
    exit 1
  }
}
finally {
  Pop-Location
}

Write-Success "Docker services started / Docker 服务已启动"

# Step 7: Wait for services to be ready
Write-Step "Waiting for Services / 等待服务就绪"
if (Wait-ForServices -TimeoutSeconds 180) {
  Write-Success "All services are ready / 所有服务已就绪"
}
else {
  Write-Warning "Some services may not be ready yet / 部分服务可能尚未就绪"
  Write-Info "Please check manually / 请手动检查"
}

# Step 8: Display completion message
Write-Host @"

  ====================================================================
               Installation Complete / 安装完成
  ====================================================================

  Frontend:          http://localhost:30000
  Backend:           http://localhost:8000/health
  Core Engine:       http://localhost:8001/health

  Next Steps / 后续操作:
  - Start services / 启动服务:    .\start.ps1
  - Stop services / 停止服务:     .\stop.ps1
  - View logs / 查看日志:         docker compose logs -f
  - View status / 查看状态:       docker compose ps

  ====================================================================

"@ -ForegroundColor Green
