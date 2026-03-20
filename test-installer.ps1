<#
.SYNOPSIS
    Test script for install.ps1
.DESCRIPTION
    This script tests the install.ps1 script with mock inputs.
#>

param(
  [string]$BaseUrl = "https://api.openai.com/v1",
  [string]$ApiKey = "sk-test-mock-key-12345",
  [string]$Model = "gpt-4-turbo-preview",
  [string]$Provider = "openai"
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Detect CI environment
$IsCI = $env:CI -eq 'true' -or $env:GITHUB_ACTIONS -eq 'true'

# Helper functions
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

function Write-Skip {
  param([string]$Message)
  Write-Host "  [SKIP] $Message" -ForegroundColor Gray
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

function Test-Administrator {
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DockerInstalled {
  # Check if docker command is available (works in CI environments)
  $dockerCmd = Get-Command 'docker' -ErrorAction SilentlyContinue
  if ($dockerCmd) {
    return $true
  }

  # Check Docker Desktop paths (Windows desktop)
  $dockerPaths = @(
    "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  )
  foreach ($path in $dockerPaths) {
    if (Test-Path -LiteralPath $path) {
      return $true
    }
  }

  return $false
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
    throw "Template file not found: $TemplatePath"
  }
  $content = Get-Content -LiteralPath $TemplatePath -Raw
  $content = $content -replace 'LLM_PROVIDER=.*', "LLM_PROVIDER=$Provider"
  $content = $content -replace 'LLM_API_KEY=.*', "LLM_API_KEY=$ApiKey"
  $content = $content -replace 'LLM_MODEL=.*', "LLM_MODEL=$Model"
  $content = $content -replace 'LLM_BASE_URL=.*', "LLM_BASE_URL=$BaseUrl"
  if ($Provider -eq 'openai') {
    $content = $content -replace 'OPENAI_API_KEY=.*', "OPENAI_API_KEY=$ApiKey"
    $content = $content -replace 'OPENAI_MODEL=.*', "OPENAI_MODEL=$Model"
    $content = $content -replace 'OPENAI_BASE_URL=.*', "OPENAI_BASE_URL=$BaseUrl"
  }
  Set-Content -LiteralPath $OutputPath -Value $content -NoNewline
}

# Main test
Write-Host @"

  ====================================================================
           Testing StructureClaw Installer / Testing Install Scripts
  ====================================================================

"@ -ForegroundColor Cyan

if ($IsCI) {
  Write-Info "Running in CI environment / 在 CI 环境中运行"
}

$allPassed = $true
$dockerAvailable = $false

# Test 1: Check Docker Installed
Write-Step "Test 1: Docker Installation Check / Docker Installation Check"
if (Test-DockerInstalled) {
  Write-Success "Docker is available / Docker 可用"
  $dockerAvailable = $true
}
else {
  Write-Warning "Docker is not installed / Docker 未安装"
  if ($IsCI) {
    Write-Warning "Docker tests will be skipped / Docker 相关测试将被跳过"
  }
  else {
    $allPassed = $false
  }
}

# Test 2: Check Docker Running (only if Docker is installed)
Write-Step "Test 2: Docker Service Check / Docker Service Check"
if ($dockerAvailable) {
  if (Test-DockerRunning) {
    Write-Success "Docker service is running / Docker 服务运行中"
  }
  else {
    Write-Warning "Docker service is not running / Docker 服务未运行"
    if (-not $IsCI) {
      Write-Info "This is OK for script testing / 脚本测试时可接受"
    }
  }
}
else {
  Write-Skip "Docker not available, skipping / Docker 不可用，跳过"
}

# Test 3: Check .env.example exists
Write-Step "Test 3: Template File Check / Template File Check"
$EnvExampleFile = Join-Path $RootDir '.env.example'
if (Test-Path -LiteralPath $EnvExampleFile) {
  Write-Success ".env.example exists / .env.example 存在"
}
else {
  Write-Error ".env.example not found / .env.example 不存在"
  $allPassed = $false
}

# Test 4: Generate .env file
Write-Step "Test 4: Generate .env File / Generate .env File"
$EnvFile = Join-Path $RootDir '.env.test'
try {
  New-EnvFile -TemplatePath $EnvExampleFile -OutputPath $EnvFile `
    -BaseUrl $BaseUrl -ApiKey $ApiKey -Model $Model -Provider $Provider
  Write-Success ".env.test generated / .env.test 已生成"

  # Verify content
  $envContent = Get-Content -LiteralPath $EnvFile -Raw
  if ($envContent -match "LLM_PROVIDER=$Provider" -and
      $envContent -match "LLM_BASE_URL=$BaseUrl" -and
      $envContent -match "LLM_MODEL=$Model") {
    Write-Success ".env content verified / .env 内容验证通过"
  }
  else {
    Write-Error ".env content verification failed / .env 内容验证失败"
    $allPassed = $false
  }

  # Cleanup
  Remove-Item -LiteralPath $EnvFile -Force
  Write-Info "Cleaned up .env.test / 已清理 .env.test"
}
catch {
  Write-Error "Failed to generate .env file / 生成 .env 文件失败: $_"
  $allPassed = $false
}

# Test 5: Administrator check
Write-Step "Test 5: Administrator Check / Administrator Check"
if (Test-Administrator) {
  Write-Success "Running as administrator / 以管理员权限运行"
}
else {
  Write-Warning "Not running as administrator / 未以管理员权限运行"
  Write-Info "This is OK for testing / 测试时可以接受"
}

# Test 6: Script syntax validation
Write-Step "Test 6: Script Syntax Check / Script Syntax Check"
$scripts = @('install.ps1', 'start.ps1', 'stop.ps1')
$syntaxOk = $true

foreach ($script in $scripts) {
  $scriptPath = Join-Path $RootDir $script
  if (Test-Path -LiteralPath $scriptPath) {
    try {
      $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -LiteralPath $scriptPath -Raw), [ref]$null)
      Write-Success "$script syntax OK / $script 语法正确"
    }
    catch {
      Write-Error "$script has syntax errors / $script 有语法错误: $_"
      $syntaxOk = $false
      $allPassed = $false
    }
  }
  else {
    Write-Error "$script not found / $script 不存在"
    $allPassed = $false
  }
}

# Summary
Write-Host @"

  ====================================================================
              Test Summary / Test Summary
  ====================================================================

"@ -ForegroundColor $(if ($allPassed) { 'Green' } else { 'Red' })

if ($allPassed) {
  Write-Host "  All tests passed / All tests passed" -ForegroundColor Green
  exit 0
}
else {
  Write-Host "  Some tests failed / Some tests failed" -ForegroundColor Red
  exit 1
}
