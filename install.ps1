<#
.SYNOPSIS
    StructureClaw One-click Installer
.DESCRIPTION
    This script guides users through the installation and configuration of StructureClaw.
.PARAMETER DockerInstallerPath
    Path to Docker Desktop installer (optional)
.EXAMPLE
    .\install.ps1
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
      Write-Info "Starting Docker Desktop..."
      Start-Process -FilePath $path
      return $true
    }
  }
  return $false
}

function Wait-ForDocker {
  param([int]$TimeoutSeconds = 120)
  Write-Info "Waiting for Docker to start (max $TimeoutSeconds seconds)..."
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

function Test-ApiConnection {
  param(
    [string]$BaseUrl,
    [string]$ApiKey,
    [string]$Model,
    [string]$Provider
  )
  Write-Info "Testing API connection to $BaseUrl..."
  try {
    $chatUrl = $BaseUrl.TrimEnd('/')
    if (-not $chatUrl.EndsWith('/chat/completions')) {
      $chatUrl = "$chatUrl/chat/completions"
    }
    $headers = @{
      "Content-Type" = "application/json"
      "Authorization" = "Bearer $ApiKey"
    }
    $body = @{
      model = $Model
      messages = @(@{role = "user"; content = "Hi"})
      max_tokens = 5
    } | ConvertTo-Json -Depth 2
    try {
      $response = Invoke-RestMethod -Uri $chatUrl -Headers $headers -Method Post -Body $body -TimeoutSec 30
      Write-Success "API connection successful"
      return $true
    }
    catch {
      Write-Warning "API connection test failed: $($_.Exception.Message)"
      return $false
    }
  }
  catch {
    Write-Warning "API connection test failed: $($_.Exception.Message)"
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
  param(
    [string]$EnvPath,
    [int]$TimeoutSeconds = 180
  )
  Write-Info "Waiting for services to start (max $TimeoutSeconds seconds)..."

  # Read ports from .env file
  $frontendPort = Get-EnvPort -EnvPath $EnvPath -VarName "FRONTEND_PORT" -DefaultPort "30000"
  $backendPort = Get-EnvPort -EnvPath $EnvPath -VarName "PORT" -DefaultPort "30010"
  $corePort = Get-EnvPort -EnvPath $EnvPath -VarName "CORE_PORT" -DefaultPort "30011"

  Write-Info "Ports - Frontend: $frontendPort, Backend: $backendPort, Core: $corePort"

  $startTime = Get-Date
  $timeout = $startTime.AddSeconds($TimeoutSeconds)
  $services = @(
    @{Name = 'Frontend'; Url = "http://localhost:$frontendPort"},
    @{Name = 'Backend'; Url = "http://localhost:$backendPort/health"},
    @{Name = 'Core'; Url = "http://localhost:$corePort/health"}
  )
  $ready = @{}
  while ((Get-Date) -lt $timeout) {
    $allReady = $true
    foreach ($service in $services) {
      if (-not $ready[$service.Name]) {
        if (Test-HttpEndpoint -Uri $service.Url) {
          $ready[$service.Name] = $true
          Write-Success "$($service.Name) ready"
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
  while (-not $process.StandardOutput.EndOfStream) {
    $line = $process.StandardOutput.ReadLine()
    if ($line -match "Successfully|built|Created|Started") {
      Write-Host "    $line" -ForegroundColor Green
    }
    elseif ($line -ne "") {
      Write-Host "    $line" -ForegroundColor Gray
    }
  }
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
           One-click Installer

"@ -ForegroundColor Cyan

# Step 1: Check privileges
Write-Step "Checking Privileges"
if (Test-Administrator) {
  Write-Success "Running with administrator privileges"
}
else {
  Write-Warning "Not running as administrator"
}

# Step 2: Check Docker Desktop
Write-Step "Checking Docker Desktop"
if (Test-DockerInstalled) {
  Write-Success "Docker Desktop is installed"
}
else {
  Write-Warning "Docker Desktop is not installed"
  Write-Host "  Please install Docker Desktop from: https://www.docker.com/products/docker-desktop" -ForegroundColor White
  if ($DockerInstallerPath -and (Test-Path -LiteralPath $DockerInstallerPath)) {
    Write-Info "Installing Docker Desktop..."
    Start-Process -FilePath $DockerInstallerPath -Wait
    exit 0
  }
  Write-Host "  Press any key to exit..." -ForegroundColor Gray
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

# Step 3: Check Docker service
Write-Step "Checking Docker Service"
if (Test-DockerRunning) {
  Write-Success "Docker service is running"
}
else {
  Write-Warning "Docker service is not running"
  if (Start-DockerDesktop) {
    if (Wait-ForDocker -TimeoutSeconds 120) {
      Write-Success "Docker service started successfully"
    }
    else {
      Write-Error "Docker service startup timeout"
      exit 1
    }
  }
  else {
    Write-Error "Cannot start Docker Desktop"
    exit 1
  }
}

# Step 4: Collect LLM configuration
Write-Step "Configure LLM Service"
Write-Host "  Please enter LLM service configuration (API Key input will be hidden)" -ForegroundColor Gray
Write-Host ""

$llmProvider = Read-Host "  LLM Provider [openai]"
if ([string]::IsNullOrWhiteSpace($llmProvider)) {
  $llmProvider = 'openai'
}

$llmBaseUrl = Read-Host "  LLM Base URL (e.g. https://api.deepseek.com)"
while ([string]::IsNullOrWhiteSpace($llmBaseUrl)) {
  Write-Warning "LLM Base URL cannot be empty"
  $llmBaseUrl = Read-Host "  LLM Base URL"
}

$llmApiKey = Read-SecureInput "LLM API Key: "
while ([string]::IsNullOrWhiteSpace($llmApiKey)) {
  Write-Warning "LLM API Key cannot be empty"
  $llmApiKey = Read-SecureInput "LLM API Key: "
}

$llmModel = Read-Host "  LLM Model (e.g. deepseek-chat)"
while ([string]::IsNullOrWhiteSpace($llmModel)) {
  Write-Warning "LLM Model cannot be empty"
  $llmModel = Read-Host "  LLM Model"
}

Write-Success "LLM configuration collected"

# Step 4.5: Test API connection
Write-Step "Testing API Connection"
$apiTestResult = Test-ApiConnection -BaseUrl $llmBaseUrl -ApiKey $llmApiKey -Model $llmModel -Provider $llmProvider
if (-not $apiTestResult) {
  Write-Warning "API test failed, but continuing with installation"
}

# Step 5: Generate .env file
Write-Step "Generating Configuration File"
try {
  New-EnvFile -TemplatePath $EnvExampleFile -OutputPath $EnvFile `
    -BaseUrl $llmBaseUrl -ApiKey $llmApiKey -Model $llmModel -Provider $llmProvider
  Write-Success ".env file generated"
}
catch {
  Write-Error "Failed to generate .env file: $_"
  exit 1
}

# Step 6: Build and start services
Write-Step "Building and Starting Services"
Write-Info "Building Docker images (first build may take a few minutes)..."
Write-Host ""

Push-Location $RootDir
try {
  Write-Progress "Pulling base images and building..."
  $exitCode = Invoke-DockerCompose -Arguments "up --build -d"
  if ($exitCode -ne 0) {
    Write-Error "Docker Compose startup failed"
    Write-Host "  Please check the error and run manually: docker compose up --build" -ForegroundColor Yellow
    exit 1
  }
}
finally {
  Pop-Location
}

Write-Success "Docker services started"

# Step 7: Wait for services to be ready
Write-Step "Waiting for Services"
if (Wait-ForServices -EnvPath $EnvFile -TimeoutSeconds 180) {
  Write-Success "All services are ready"
}
else {
  Write-Warning "Some services may not be ready yet"
}

# Read ports for display
$frontendPort = Get-EnvPort -EnvPath $EnvFile -VarName "FRONTEND_PORT" -DefaultPort "30000"
$backendPort = Get-EnvPort -EnvPath $EnvFile -VarName "PORT" -DefaultPort "30010"
$corePort = Get-EnvPort -EnvPath $EnvFile -VarName "CORE_PORT" -DefaultPort "30011"

# Step 8: Display completion message
Write-Host @"

  ====================================================================
                    Installation Complete
  ====================================================================

  Frontend:          http://localhost:$frontendPort
  Backend:           http://localhost:$backendPort/health
  Core Engine:       http://localhost:$corePort/health

  Next Steps:
  - Start services:    .\start.ps1
  - Stop services:     .\stop.ps1
  - View logs:         docker compose logs -f
  - View status:       docker compose ps

  ====================================================================

"@ -ForegroundColor Green
