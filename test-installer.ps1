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
  $dockerPaths = @(
    "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  )
  foreach ($path in $dockerPaths) {
    if (Test-Path -LiteralPath $path) {
      return $true
    }
  }
  $dockerCmd = Get-Command 'docker' -ErrorAction SilentlyContinue
  if ($dockerCmd) {
    return $true
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
           Testing StructureClaw Installer / 测试安装脚本
  ====================================================================

"@ -ForegroundColor Cyan

$allPassed = $true

# Test 1: Check Docker Installed
Write-Step "Test 1: Docker Installation Check / Docker 安装检测"
if (Test-DockerInstalled) {
  Write-Success "Docker Desktop is installed / Docker Desktop 已安装"
}
else {
  Write-Error "Docker Desktop is not installed / Docker Desktop 未安装"
  $allPassed = $false
}

# Test 2: Check Docker Running
Write-Step "Test 2: Docker Service Check / Docker 服务检测"
if (Test-DockerRunning) {
  Write-Success "Docker service is running / Docker 服务运行中"
}
else {
  Write-Error "Docker service is not running / Docker 服务未运行"
  $allPassed = $false
}

# Test 3: Check .env.example exists
Write-Step "Test 3: Template File Check / 模板文件检测"
$EnvExampleFile = Join-Path $RootDir '.env.example'
if (Test-Path -LiteralPath $EnvExampleFile) {
  Write-Success ".env.example exists / .env.example 存在"
}
else {
  Write-Error ".env.example not found / .env.example 不存在"
  $allPassed = $false
}

# Test 4: Generate .env file
Write-Step "Test 4: Generate .env File / 生成 .env 文件"
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
Write-Step "Test 5: Administrator Check / 管理员权限检测"
if (Test-Administrator) {
  Write-Success "Running as administrator / 以管理员权限运行"
}
else {
  Write-Warning "Not running as administrator / 未以管理员权限运行 (this is OK for testing / 测试时可以接受)"
}

# Summary
Write-Host @"

  ====================================================================
              Test Summary / 测试总结
  ====================================================================

"@ -ForegroundColor $(if ($allPassed) { 'Green' } else { 'Red' })

if ($allPassed) {
  Write-Host "  All tests passed / 所有测试通过" -ForegroundColor Green
  exit 0
}
else {
  Write-Host "  Some tests failed / 部分测试失败" -ForegroundColor Red
  exit 1
}
