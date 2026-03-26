[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$OutEnv = if ($env:STRUCTURECLAW_COMPOSE_ENV_FILE) {
  $env:STRUCTURECLAW_COMPOSE_ENV_FILE
} else {
  Join-Path $RootDir '.runtime/ci-docker-smoke.env'
}
$ComposeFile = Join-Path $RootDir 'docker-compose.yml'
$EnvExampleFile = Join-Path $RootDir '.env.example'
$RuntimeDataDir = Join-Path $RootDir '.runtime/data'

function Write-SmokeLog {
  param([string]$Message)
  Write-Host "[ci-docker-smoke] $Message"
}

function Get-EnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $escapedKey = [regex]::Escape($Key)
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    if ($rawLine -match "^${escapedKey}=(.*)$") {
      return $Matches[1].Trim()
    }
  }

  return $null
}

function Write-SmokeEnv {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutEnv) | Out-Null

  $outputLines = foreach ($rawLine in Get-Content -LiteralPath $EnvExampleFile) {
    $line = $rawLine.TrimEnd("`r")
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
      $rawLine
      continue
    }

    switch -Regex ($line) {
      '^DATABASE_URL=' { 'DATABASE_URL=file:/.runtime/data/structureclaw.db'; continue }
      '^LLM_API_KEY=' { 'LLM_API_KEY=ci-dummy-key'; continue }
      '^LLM_MODEL=' { 'LLM_MODEL=gpt-4-turbo-preview'; continue }
      '^LLM_BASE_URL=' { 'LLM_BASE_URL=https://api.openai.com/v1'; continue }
      '^NGINX_HTTP_PORT=' { 'NGINX_HTTP_PORT=18080'; continue }
      '^NGINX_HTTPS_PORT=' { 'NGINX_HTTPS_PORT=18443'; continue }
      default { $rawLine }
    }
  }

  Set-Content -LiteralPath $OutEnv -Value $outputLines
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)

  $commandArgs = @(
    'compose',
    '-f', $ComposeFile,
    '--env-file', $OutEnv
  ) + $ComposeArgs

  & docker @commandArgs
}

function Cleanup {
  try {
    Write-SmokeLog 'docker compose down'
    Invoke-Compose -ComposeArgs @('down', '--remove-orphans') 2>$null
  } catch {
    # Best effort cleanup for CI.
  }
}

$exitCode = 0

try {
  if (-not (Test-Path -LiteralPath $EnvExampleFile)) {
    Write-SmokeLog 'missing .env.example'
    $exitCode = 1
    return
  }

  Write-SmokeEnv
  New-Item -ItemType Directory -Force -Path $RuntimeDataDir | Out-Null

  Write-SmokeLog 'docker compose config'
  Invoke-Compose -ComposeArgs @('config', '-q')

  Write-SmokeLog 'docker compose up --build -d'
  Invoke-Compose -ComposeArgs @('up', '--build', '-d')

  $backendPort = Get-EnvValue -Path $OutEnv -Key 'PORT'
  $frontendPort = Get-EnvValue -Path $OutEnv -Key 'FRONTEND_PORT'
  if ([string]::IsNullOrWhiteSpace($backendPort)) {
    $backendPort = '8000'
  }
  if ([string]::IsNullOrWhiteSpace($frontendPort)) {
    $frontendPort = '30000'
  }

  $backendUrl = "http://127.0.0.1:$backendPort/health"
  $frontendUrl = "http://127.0.0.1:$frontendPort/"

  Write-SmokeLog "wait for backend $backendUrl"
  $deadline = (Get-Date).AddMinutes(5)
  $backendOk = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $backendUrl -Method Get -TimeoutSec 5 -UseBasicParsing
      if ($response.StatusCode -eq 200) {
        $backendOk = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 3
      continue
    }
    Start-Sleep -Seconds 3
  }

  if (-not $backendOk) {
    Write-SmokeLog 'backend health check failed'
    try {
      Invoke-Compose -ComposeArgs @('ps')
    } catch {
      # Best effort diagnostics.
    }
    $exitCode = 1
    return
  }

  Write-SmokeLog "probe frontend $frontendUrl"
  try {
    $frontendResponse = Invoke-WebRequest -Uri $frontendUrl -Method Get -TimeoutSec 10 -MaximumRedirection 0 -UseBasicParsing
    $frontendStatusCode = [int]$frontendResponse.StatusCode
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode) {
      $frontendStatusCode = [int]$statusCode
    } else {
      $frontendStatusCode = 0
    }
  }

  if ($frontendStatusCode -notin @(200, 304, 307)) {
    Write-SmokeLog "frontend returned HTTP $frontendStatusCode (continuing if backend ok)"
  }

  Write-SmokeLog 'docker compose smoke passed'
} finally {
  Cleanup
}

exit $exitCode
