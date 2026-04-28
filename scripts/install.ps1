param(
  [string]$Registry = "",
  [string]$NodeDistBase = $env:SCLAW_NODE_DIST_BASE,
  [string]$Package = $(if ($env:SCLAW_PACKAGE_NAME) { $env:SCLAW_PACKAGE_NAME } else { "@structureclaw/structureclaw" }),
  [string]$Tag = $(if ($env:SCLAW_PACKAGE_TAG) { $env:SCLAW_PACKAGE_TAG } else { "latest" }),
  [string]$Prefix = $(if ($env:SCLAW_NPM_PREFIX) { $env:SCLAW_NPM_PREFIX } else { Join-Path $HOME ".structureclaw\npm-global" }),
  [switch]$Cn,
  [switch]$SkipDoctor,
  [switch]$DryRun,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$MinNodeMajor = 20

function Write-InstallLog {
  param([string]$Message)
  Write-Host "[sclaw-install] $Message"
}

function Stop-Install {
  param([string]$Message)
  Write-Error "[sclaw-install] ERROR: $Message"
  exit 1
}

function Show-Help {
  @"
Usage: powershell -ExecutionPolicy Bypass -File scripts/install.ps1 [options]

Install StructureClaw for Windows users who may not have Node.js yet.

Options:
  -Cn                    Use China-friendly npm and Node mirrors.
  -Registry <url>        npm registry to use for the package install.
  -NodeDistBase <url>    Node.js dist base, default latest-v20.x.
  -Package <name>        npm package name, default @structureclaw/structureclaw.
  -Tag <tag>             npm dist-tag/version, default latest.
  -Prefix <dir>          npm global prefix, default ~/.structureclaw/npm-global.
  -SkipDoctor            Do not run sclaw doctor after installing.
  -DryRun                Print commands without changing the system.
  -Help                  Show this help.

Environment overrides:
  SCLAW_NODE_DIST_BASE, SCLAW_PACKAGE_NAME, SCLAW_PACKAGE_TAG,
  SCLAW_NPM_PREFIX, NPM_CONFIG_REGISTRY
"@
}

if ($Help) {
  Show-Help
  exit 0
}

if (-not $NodeDistBase) {
  $NodeDistBase = "https://nodejs.org/dist/latest-v20.x"
}

if ($Cn) {
  if (-not $Registry) {
    $Registry = "https://registry.npmmirror.com"
  }
  if (-not $env:SCLAW_NODE_DIST_BASE) {
    $NodeDistBase = "https://npmmirror.com/mirrors/node/latest-v20.x"
  }
}

if ($Registry) {
  $env:NPM_CONFIG_REGISTRY = $Registry
} elseif ($env:NPM_CONFIG_REGISTRY) {
  $Registry = $env:NPM_CONFIG_REGISTRY
}

function Invoke-InstallCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @()
  )

  if ($DryRun) {
    Write-InstallLog ("DRY RUN: {0} {1}" -f $FilePath, ($ArgumentList -join " "))
    return
  }

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    Stop-Install "Command failed: $FilePath $($ArgumentList -join ' ')"
  }
}

function Get-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-NodeMajor {
  $node = Get-CommandPath "node"
  if (-not $node) { return 0 }

  try {
    $version = & $node -p "Number(process.versions.node.split('.')[0])" 2>$null
    return [int]$version
  } catch {
    return 0
  }
}

function Get-NodeWindowsArch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { return "arm64" }
    "AMD64" { return "x64" }
    default { return "x64" }
  }
}

function Invoke-Download {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  if ($DryRun) {
    Write-InstallLog "DRY RUN: download $Url -> $OutFile"
    return
  }

  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
}

function Add-UserPath {
  param([Parameter(Mandatory = $true)][string]$PathToAdd)

  $env:PATH = "$PathToAdd;$env:PATH"
  if ($DryRun) {
    Write-InstallLog "DRY RUN: add user PATH $PathToAdd"
    return
  }

  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($current) {
    $parts = $current -split ";" | Where-Object { $_ -and $_.Trim() }
  }

  $exists = $parts | Where-Object { $_.TrimEnd("\") -ieq $PathToAdd.TrimEnd("\") }
  if (-not $exists) {
    $next = (@($PathToAdd) + $parts) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
    Write-InstallLog "Added $PathToAdd to the user PATH. Open a new terminal to pick it up."
  }
}

function Ensure-Node {
  $npm = Get-CommandPath "npm"
  if ($npm -and (Get-NodeMajor) -ge $MinNodeMajor) {
    Write-InstallLog "Using existing Node.js $(& node -v)"
    return
  }

  $arch = Get-NodeWindowsArch
  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ("sclaw-node-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

  try {
    $sumsPath = Join-Path $tempDir "SHASUMS256.txt"
    Write-InstallLog "Resolving latest Node.js 20 for win-$arch..."
    Invoke-Download "$NodeDistBase/SHASUMS256.txt" $sumsPath

    $pattern = "node-(v[0-9][^\s]*)-win-$arch\.zip"
    $version = $null
    $expectedHash = $null
    foreach ($line in Get-Content $sumsPath) {
      if ($line -match $pattern) {
        $version = $Matches[1]
        $expectedHash = ($line -split "\s+")[0].ToLowerInvariant()
        break
      }
    }
    if (-not $version) {
      Stop-Install "Could not resolve Node.js version from $NodeDistBase"
    }

    $archive = "node-$version-win-$arch.zip"
    $installParent = Join-Path $HOME ".structureclaw\node"
    $installRoot = Join-Path $installParent $version
    $nodeExe = Join-Path $installRoot "node.exe"

    if (-not (Test-Path $nodeExe)) {
      Write-InstallLog "Installing Node.js $version to $installRoot..."
      $archivePath = Join-Path $tempDir $archive
      Invoke-Download "$NodeDistBase/$archive" $archivePath

      if (-not $DryRun) {
        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash) {
          Stop-Install "Checksum mismatch for $archive"
        }
        New-Item -ItemType Directory -Force -Path $installParent | Out-Null
        Expand-Archive -LiteralPath $archivePath -DestinationPath $tempDir -Force
        $expanded = Join-Path $tempDir "node-$version-win-$arch"
        if (Test-Path $installRoot) {
          Remove-Item -LiteralPath $installRoot -Recurse -Force
        }
        Move-Item -LiteralPath $expanded -Destination $installRoot
      }
    }

    Add-UserPath $installRoot
    if (-not (Get-CommandPath "node") -or -not (Get-CommandPath "npm")) {
      Stop-Install "Node.js installation finished, but node/npm is still unavailable"
    }
    Write-InstallLog "Using Node.js $(& node -v)"
  } finally {
    if (-not $DryRun -and (Test-Path $tempDir)) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

Ensure-Node

if (-not (Test-Path $Prefix) -and -not $DryRun) {
  New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
}

$env:NPM_CONFIG_PREFIX = $Prefix
Add-UserPath $Prefix

if ($Registry) {
  Write-InstallLog "Using npm registry: $Registry"
}

Write-InstallLog "Installing $Package@$Tag..."
Invoke-InstallCommand "npm" @("install", "-g", "$Package@$Tag")

if ($DryRun) {
  Write-InstallLog "Dry run complete. No package was installed."
  exit 0
}

if (-not (Get-CommandPath "sclaw")) {
  Stop-Install "sclaw is not available on PATH. Add $Prefix to PATH and open a new PowerShell window."
}

try {
  $versionText = & sclaw version 2>$null
  Write-InstallLog "Installed $versionText"
} catch {
  Write-InstallLog "Installed StructureClaw"
}

if ($SkipDoctor) {
  Write-InstallLog "Skipped doctor. Run 'sclaw doctor' when ready."
} else {
  Write-InstallLog "Running sclaw doctor..."
  Invoke-InstallCommand "sclaw" @("doctor")
}

Write-InstallLog "Done. Start StructureClaw with: sclaw start"
