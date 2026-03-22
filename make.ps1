[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Target = 'help',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$RestArgs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $RootDir '.runtime'
$LogDir = Join-Path $RuntimeDir 'logs'
$PidDir = Join-Path $RuntimeDir 'pids'
$EnvFile = Join-Path $RootDir '.env'
$EnvExampleFile = Join-Path $RootDir '.env.example'
$AnalysisVenvDir = Join-Path $RootDir 'backend/.venv'
$AnalysisPython = Join-Path $AnalysisVenvDir 'Scripts/python.exe'
$ServiceRunner = Join-Path $RootDir 'scripts/windows/run-service.ps1'
$IsWindowsHost = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
$DefaultAnalysisPythonVersion = if ($IsWindowsHost) { '3.12' } else { '3.11' }
$AnalysisPythonVersion = if ($env:ANALYSIS_PYTHON_VERSION) { $env:ANALYSIS_PYTHON_VERSION } else { $DefaultAnalysisPythonVersion }

function Write-Info {
  param([string]$Message)
  Write-Host $Message
}

function Fail {
  param([string]$Message)
  throw $Message
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Ensure-FileFromExample {
  param(
    [string]$Path,
    [string]$ExamplePath
  )

  if (-not (Test-Path -LiteralPath $Path) -and (Test-Path -LiteralPath $ExamplePath)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $Path
    Write-Info "Created $Path from example."
  }
}

function Load-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
      continue
    }

    $separator = $line.IndexOf('=')
    if ($separator -lt 1) {
      continue
    }

    $key = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
    Set-Item -Path ("Env:{0}" -f $key) -Value $value
  }

  return $values
}

function Set-ConfigValue {
  param(
    [hashtable]$DotEnv,
    [string]$Name,
    [string]$Value
  )

  $DotEnv[$Name] = $Value
  Set-Item -Path ("Env:{0}" -f $Name) -Value $Value
}

function Normalize-SqliteFileUrl {
  param([string]$DatabaseUrl)

  if ([string]::IsNullOrWhiteSpace($DatabaseUrl) -or -not $DatabaseUrl.StartsWith('file:')) {
    return $DatabaseUrl
  }

  $suffix = $DatabaseUrl.Substring(5)
  $queryIndex = $suffix.IndexOf('?')
  if ($queryIndex -ge 0) {
    $location = $suffix.Substring(0, $queryIndex)
    $query = $suffix.Substring($queryIndex)
  }
  else {
    $location = $suffix
    $query = ''
  }

  if ([string]::IsNullOrWhiteSpace($location)) {
    return $DatabaseUrl
  }

  $normalizedPath = if ([System.IO.Path]::IsPathRooted($location)) {
    $location
  }
  else {
    [System.IO.Path]::GetFullPath((Join-Path $RootDir ('backend/prisma/' + $location)))
  }

  return 'file:' + $normalizedPath.Replace('\', '/') + $query
}

function Ensure-LocalSqliteConfig {
  param([hashtable]$DotEnv)

  $databaseUrl = Get-ConfigValue -DotEnv $DotEnv -Name 'DATABASE_URL' -DefaultValue 'file:../../.runtime/data/structureclaw.db'
  if ($databaseUrl.StartsWith('file:')) {
    $normalizedSqliteUrl = Normalize-SqliteFileUrl -DatabaseUrl $databaseUrl
    if ($normalizedSqliteUrl -ne $databaseUrl) {
      Write-Info ("Normalizing SQLite DATABASE_URL for Windows local workflow: {0}" -f $normalizedSqliteUrl)
      Set-ConfigValue -DotEnv $DotEnv -Name 'DATABASE_URL' -Value $normalizedSqliteUrl
    }
    return
  }

  $lowerDatabaseUrl = $databaseUrl.ToLowerInvariant()
  $isLegacyLocalPostgres = $lowerDatabaseUrl.StartsWith('postgresql://') -and (
    $lowerDatabaseUrl.Contains('@localhost:') -or
    $lowerDatabaseUrl.Contains('@127.0.0.1:')
  )

  if (-not $isLegacyLocalPostgres) {
    Fail "Windows local workflow expects a SQLite DATABASE_URL. Current value: $databaseUrl"
  }

  $sqlitePath = Join-Path $RootDir '.runtime/data/structureclaw.db'
  $sqliteUrl = 'file:' + $sqlitePath.Replace('\', '/')
  Write-Info ("Detected legacy local PostgreSQL DATABASE_URL. Overriding to SQLite for Windows local workflow: {0}" -f $sqliteUrl)
  Set-ConfigValue -DotEnv $DotEnv -Name 'DATABASE_URL' -Value $sqliteUrl

  $existingSource = Get-ConfigValue -DotEnv $DotEnv -Name 'POSTGRES_SOURCE_DATABASE_URL' -DefaultValue ''
  if ([string]::IsNullOrWhiteSpace($existingSource)) {
    Set-ConfigValue -DotEnv $DotEnv -Name 'POSTGRES_SOURCE_DATABASE_URL' -Value $databaseUrl
  }
}

function Get-ConfigValue {
  param(
    [hashtable]$DotEnv,
    [string]$Name,
    [string]$DefaultValue
  )

  if ($DotEnv.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($DotEnv[$Name])) {
    return [string]$DotEnv[$Name]
  }

  $envValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($envValue)) {
    return [string]$envValue
  }

  return $DefaultValue
}

function Require-Command {
  param(
    [string]$Name,
    [string]$Hint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "Missing required command: $Name`n$Hint"
  }
}

function Get-CommandPath {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Get-FileHashOrBlank {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return ''
  }

  $getFileHash = Get-Command 'Get-FileHash' -ErrorAction SilentlyContinue
  if ($getFileHash) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $hashBytes = $sha256.ComputeHash($stream)
      return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '')
    }
    finally {
      $stream.Dispose()
    }
  }
  finally {
    $sha256.Dispose()
  }
}

function Test-InstalledPackageMatchesLock {
  param(
    [string]$ProjectDir,
    [string[]]$PackageNames
  )

  $lockFile = Join-Path $ProjectDir 'package-lock.json'
  if (-not (Test-Path -LiteralPath $lockFile)) {
    return $true
  }

  try {
    $lockJson = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
  }
  catch {
    return $false
  }

  foreach ($packageName in $PackageNames) {
    $installedPackageJson = Join-Path $ProjectDir ("node_modules/{0}/package.json" -f $packageName)
    if (-not (Test-Path -LiteralPath $installedPackageJson)) {
      return $false
    }

    $packageKey = "node_modules/$packageName"
    $expectedVersion = ""
    if ($null -ne $lockJson.packages) {
      $lockPackageEntry = $lockJson.packages.$packageKey
      if ($null -ne $lockPackageEntry -and $null -ne $lockPackageEntry.version) {
        $expectedVersion = [string]$lockPackageEntry.version
      }
    }

    try {
      $installedJson = Get-Content -LiteralPath $installedPackageJson -Raw | ConvertFrom-Json
    }
    catch {
      return $false
    }

    $installedVersion = ""
    if ($null -ne $installedJson.version) {
      $installedVersion = [string]$installedJson.version
    }

    if ([string]::IsNullOrWhiteSpace($expectedVersion)) {
      continue
    }

    if ($installedVersion -ne $expectedVersion) {
      Write-Info ("Installed package drift detected for {0}: have {1}, expected {2}." -f $packageName, $installedVersion, $expectedVersion)
      return $false
    }
  }

  return $true
}

function Ensure-NpmDependencies {
  param(
    [string]$ProjectDir,
    [string]$ProjectName,
    [string[]]$VersionChecks = @()
  )

  $lockFile = Join-Path $ProjectDir 'package-lock.json'
  $nodeModulesDir = Join-Path $ProjectDir 'node_modules'
  $lockSnapshot = Join-Path $nodeModulesDir '.package-lock.snapshot'
  $needsInstall = -not (Test-Path -LiteralPath $nodeModulesDir)

  if (-not $needsInstall -and (Test-Path -LiteralPath $lockFile)) {
    $needsInstall = (Get-FileHashOrBlank $lockFile) -ne (Get-FileHashOrBlank $lockSnapshot)
  }

  if (-not $needsInstall -and $VersionChecks.Count -gt 0) {
    $needsInstall = -not (Test-InstalledPackageMatchesLock -ProjectDir $ProjectDir -PackageNames $VersionChecks)
  }

  if ($needsInstall) {
    Write-Info "Installing $ProjectName dependencies..."
    & npm ci --prefix $ProjectDir
    if ($LASTEXITCODE -ne 0) {
      Fail "npm ci failed for $ProjectName."
    }

    if (Test-Path -LiteralPath $lockFile) {
      Ensure-Directory $nodeModulesDir
      Copy-Item -LiteralPath $lockFile -Destination $lockSnapshot -Force
    }
  }
}

function Test-PythonModule {
  param(
    [string]$PythonPath,
    [string]$ModuleName
  )

  if (-not (Test-Path -LiteralPath $PythonPath)) {
    return $false
  }

  & $PythonPath '-c' "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)"
  return $LASTEXITCODE -eq 0
}

function Ensure-AnalysisVenv {
  Require-Command 'uv' 'Install uv first, then rerun. Example: winget install --id AstralSoftware.UV -e'

  $needsInstall = (-not (Test-Path -LiteralPath $AnalysisPython)) -or (-not (Test-PythonModule -PythonPath $AnalysisPython -ModuleName 'uvicorn'))
  if ($needsInstall) {
    Write-Info 'Preparing analysis Python virtual environment...'
    & uv venv --python $AnalysisPythonVersion $AnalysisVenvDir
    if ($LASTEXITCODE -ne 0) {
      Fail 'uv venv failed for backend/.venv.'
    }

    & uv pip install --python $AnalysisPython --link-mode=copy -r (Join-Path $RootDir 'backend/src/agent-skills/analysis-execution/python/requirements.txt')
    if ($LASTEXITCODE -ne 0) {
      Fail 'uv pip install failed for analysis dependencies.'
    }
  }

  if (-not (Test-PythonModule -PythonPath $AnalysisPython -ModuleName 'uvicorn')) {
    Fail 'backend/.venv is present but missing uvicorn.'
  }
}

function Test-OpenSeesRuntime {
  if (-not (Test-Path -LiteralPath $AnalysisPython)) {
    return $false
  }

  $previousPythonPath = $env:PYTHONPATH
  try {
    $analysisPythonRoot = Join-Path $RootDir 'backend/src/agent-skills/analysis-execution/python'
    $geometrySkillRoot = Join-Path $RootDir 'backend/src/agent-skills/geometry-input'
    $codeCheckSkillRoot = Join-Path $RootDir 'backend/src/agent-skills/code-check'
    $materialSkillRoot = Join-Path $RootDir 'backend/src/agent-skills/material-constitutive'
    $env:PYTHONPATH = "$analysisPythonRoot;$geometrySkillRoot;$codeCheckSkillRoot;$materialSkillRoot"
    & $AnalysisPython -m providers.opensees.runtime --json *> $null
    return $LASTEXITCODE -eq 0
  }
  finally {
    if ($null -eq $previousPythonPath) {
      Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    }
    else {
      Set-Item Env:PYTHONPATH -Value $previousPythonPath
    }
  }
}

function Assert-SqliteDatabaseUrl {
  param([hashtable]$DotEnv)

  $databaseUrl = Get-ConfigValue -DotEnv $DotEnv -Name 'DATABASE_URL' -DefaultValue 'file:../../.runtime/data/structureclaw.db'
  if (-not $databaseUrl.StartsWith('file:')) {
    Fail "Windows local workflow expects a SQLite file DATABASE_URL. Current value: $databaseUrl"
  }
}

function Get-PowerShellExe {
  $pwsh = Get-CommandPath 'pwsh'
  if ($pwsh) {
    return $pwsh
  }

  $windowsPowerShell = Get-CommandPath 'powershell.exe'
  if ($windowsPowerShell) {
    return $windowsPowerShell
  }

  Fail 'Cannot find pwsh or powershell.exe.'
}

function Get-PidFile {
  param([string]$Name)
  return Join-Path $PidDir ("{0}.pid" -f $Name)
}

function Get-LogFile {
  param([string]$Name)
  return Join-Path $LogDir ("{0}.log" -f $Name)
}

function Get-TrackedPid {
  param([string]$Name)

  $pidFile = Get-PidFile $Name
  if (-not (Test-Path -LiteralPath $pidFile)) {
    return $null
  }

  $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  $pidValue = 0
  if (-not [int]::TryParse($pidText, [ref]$pidValue)) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($process) {
    return $pidValue
  }

  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  return $null
}

function Start-TrackedService {
  param(
    [string]$Name,
    [string]$CommandText
  )

  $existingPid = Get-TrackedPid $Name
  if ($existingPid) {
    Write-Info "$Name is already running (pid $existingPid)."
    return
  }

  $logFile = Get-LogFile $Name
  $pidFile = Get-PidFile $Name
  Add-Content -LiteralPath $logFile -Value ("=== [{0}] starting {1} ===" -f (Get-Date -Format s), $Name)

  # Use an encoded bootstrap script to preserve the full command text verbatim.
  # Start-Process -ArgumentList can split unquoted values with spaces, which makes
  # -CommandText bind incorrectly and causes the child shell to exit immediately.
  $escapedRootDir = $RootDir.Replace("'", "''")
  $escapedLogFile = $logFile.Replace("'", "''")
  $bootstrapScript = @"
& '$escapedRootDir/scripts/windows/run-service.ps1' -RootDir '$escapedRootDir' -LogFile '$escapedLogFile' -CommandText @'
$CommandText
'@
"@
  $encodedBootstrap = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrapScript))

  $process = Start-Process -FilePath (Get-PowerShellExe) -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    $encodedBootstrap
  ) -PassThru

  Set-Content -LiteralPath $pidFile -Value $process.Id
  Write-Info "Started $Name (pid $($process.Id))."
}

function Stop-TrackedService {
  param([string]$Name)

  $pidFile = Get-PidFile $Name
  $pidValue = Get-TrackedPid $Name
  if (-not $pidValue) {
    Write-Info "$Name is not tracked."
    return
  }

  Write-Info "Stopping $Name (pid $pidValue)..."
  & taskkill /PID $pidValue /T /F *> $null
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

function Get-LatestSessionHeader {
  param([string]$LogFile)

  if (-not (Test-Path -LiteralPath $LogFile)) {
    return $null
  }

  $matches = Select-String -LiteralPath $LogFile -Pattern '^=== \['
  if (-not $matches) {
    return $null
  }

  return @($matches)[-1].Line
}

function Show-ServiceStatus {
  param([string]$Name)

  $pidValue = Get-TrackedPid $Name
  $logFile = Get-LogFile $Name
  $header = Get-LatestSessionHeader $logFile

  if ($pidValue) {
    Write-Host "${Name}: running (pid $pidValue)"
    if ($header) {
      Write-Host "  session: $header"
    }
    return
  }

  Write-Host "${Name}: stopped"
  if ($header) {
    Write-Host "  last session: $header"
  }
}

function Test-HttpEndpoint {
  param(
    [string]$Uri,
    [string]$Method = 'Get'
  )

  try {
    Invoke-WebRequest -Uri $Uri -Method $Method -TimeoutSec 5 | Out-Null
    return $true
  }
  catch {
    return $false
  }
}

function Show-Health {
  param([hashtable]$DotEnv)

  $frontendPort = Get-ConfigValue -DotEnv $DotEnv -Name 'FRONTEND_PORT' -DefaultValue '30000'
  $backendPort = Get-ConfigValue -DotEnv $DotEnv -Name 'PORT' -DefaultValue '8000'

  Write-Host 'Health checks:'
  if (Test-HttpEndpoint -Uri ("http://localhost:{0}/health" -f $backendPort)) {
    Write-Host 'backend: healthy'
  }
  else {
    Write-Host 'backend: unavailable'
  }

  if (Test-HttpEndpoint -Uri ("http://localhost:{0}" -f $frontendPort) -Method 'Head') {
    Write-Host 'frontend: healthy'
  }
  else {
    Write-Host 'frontend: unavailable'
  }
}

function Invoke-FrontendBuild {
  Push-Location (Join-Path $RootDir 'frontend')
  $previousNodeOptions = $env:NODE_OPTIONS
  try {
    $env:NODE_OPTIONS = '--require ./scripts/fs-rename-fallback.cjs'
    & npm exec next build
    if ($LASTEXITCODE -ne 0) {
      Fail 'Frontend build failed.'
    }
  }
  finally {
    if ($null -eq $previousNodeOptions) {
      Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    }
    else {
      Set-Item Env:NODE_OPTIONS -Value $previousNodeOptions
    }
    Pop-Location
  }
}

function Invoke-BackendBuild {
  & npm run build --prefix (Join-Path $RootDir 'backend')
  if ($LASTEXITCODE -ne 0) {
    Fail 'Backend build failed.'
  }
}

function Invoke-DbInit {
  param([hashtable]$DotEnv)

  Ensure-LocalSqliteConfig -DotEnv $DotEnv
  Assert-SqliteDatabaseUrl -DotEnv $DotEnv
  Ensure-Directory (Join-Path $RootDir '.runtime/data')

  $databaseUrl = Get-ConfigValue -DotEnv $DotEnv -Name 'DATABASE_URL' -DefaultValue ''
  $env:DATABASE_URL = $databaseUrl
  Write-Info ("Running db:init with DATABASE_URL={0}" -f $databaseUrl)

  & npm run db:init --prefix (Join-Path $RootDir 'backend')
  if ($LASTEXITCODE -ne 0) {
    Fail ("Database init failed. DATABASE_URL={0}" -f $databaseUrl)
  }
}

function Invoke-LocalUp {
  param(
    [hashtable]$DotEnv,
    [switch]$SkipInfra
  )

  Require-Command 'node' 'Install Node.js 18+ and retry.'
  Require-Command 'npm' 'Install npm and retry.'
  Require-Command 'python' 'Install Python 3.11 and retry.'

  Ensure-LocalSqliteConfig -DotEnv $DotEnv
  Assert-SqliteDatabaseUrl -DotEnv $DotEnv
  Ensure-NpmDependencies -ProjectDir (Join-Path $RootDir 'backend') -ProjectName 'backend' -VersionChecks @('prisma', '@prisma/client')
  Ensure-NpmDependencies -ProjectDir (Join-Path $RootDir 'frontend') -ProjectName 'frontend' -VersionChecks @('next')
  Ensure-AnalysisVenv

  if (-not (Test-OpenSeesRuntime)) {
    Fail 'OpenSees runtime check failed in backend/.venv.'
  }

  $redisUrl = Get-ConfigValue -DotEnv $DotEnv -Name 'REDIS_URL' -DefaultValue 'disabled'
  if (-not $SkipInfra -and -not [string]::IsNullOrWhiteSpace($redisUrl) -and $redisUrl.ToLowerInvariant() -ne 'disabled') {
    Require-Command 'docker' 'Install Docker Desktop and retry, or use local-up-noinfra/start.'
    & docker compose -f (Join-Path $RootDir 'docker-compose.yml') up -d redis
    if ($LASTEXITCODE -ne 0) {
      Fail 'docker compose up -d redis failed.'
    }
  }
  elseif ($SkipInfra) {
    Write-Info 'Skipping optional infra startup.'
  }

  Invoke-DbInit -DotEnv $DotEnv

  $frontendPort = Get-ConfigValue -DotEnv $DotEnv -Name 'FRONTEND_PORT' -DefaultValue '30000'

  Start-TrackedService -Name 'backend' -CommandText 'npm run dev --prefix backend'
  Start-TrackedService -Name 'frontend' -CommandText ('$env:FRONTEND_PORT = ''{0}''; $env:PORT = ''{0}''; npm --prefix frontend run dev' -f $frontendPort)

  Write-Host ''
  Write-Host 'Local stack started.'
  Write-Host ("Logs: {0}" -f $LogDir)
  Write-Host ("Frontend: http://localhost:{0}" -f $frontendPort)
  Write-Host ("Backend:  http://localhost:{0} (use /health)" -f (Get-ConfigValue -DotEnv $DotEnv -Name 'PORT' -DefaultValue '8000'))
}

function Invoke-Logs {
  param([string[]]$Args)

  $target = 'all'
  $follow = $false
  if ($Args.Count -ge 1 -and $Args[0]) {
    $target = $Args[0]
  }
  if ($Args -contains '--follow') {
    $follow = $true
  }

  $files = switch ($target) {
    'backend' { @(Get-LogFile 'backend') }
    'frontend' { @(Get-LogFile 'frontend') }
    default { @((Get-LogFile 'frontend'), (Get-LogFile 'backend')) }
  }

  foreach ($file in $files) {
    if (Test-Path -LiteralPath $file) {
      Write-Host ("----- {0} -----" -f (Split-Path -Leaf $file))
      Get-Content -LiteralPath $file -Tail 80
    }
    else {
      Write-Host ("Log file not found yet: {0}" -f $file)
    }
  }

  if ($follow) {
    Get-Content -LiteralPath $files -Tail 40 -Wait
  }
}

function Invoke-Doctor {
  param([hashtable]$DotEnv)

  Require-Command 'node' 'Install Node.js 18+ and retry.'
  Require-Command 'npm' 'Install npm and retry.'
  Require-Command 'python' 'Install Python 3.11 and retry.'
  Require-Command 'uv' 'Install uv first, then rerun. Example: winget install --id AstralSoftware.UV -e'

  Ensure-LocalSqliteConfig -DotEnv $DotEnv
  Assert-SqliteDatabaseUrl -DotEnv $DotEnv
  Ensure-NpmDependencies -ProjectDir (Join-Path $RootDir 'backend') -ProjectName 'backend' -VersionChecks @('prisma', '@prisma/client')
  Ensure-NpmDependencies -ProjectDir (Join-Path $RootDir 'frontend') -ProjectName 'frontend' -VersionChecks @('next')
  Ensure-AnalysisVenv

  if (-not (Test-OpenSeesRuntime)) {
    Fail 'OpenSees runtime check failed in backend/.venv.'
  }

  Invoke-DbInit -DotEnv $DotEnv
  Write-Host 'Windows startup checks passed.'
}

function Show-Help {
@'
StructureClaw Windows command hub / Windows 命令入口

Usage:
  .\make.ps1 help
  .\make.ps1 install
  .\make.ps1 doctor
  .\make.ps1 start
  .\make.ps1 restart
  .\make.ps1 stop
  .\make.ps1 status
  .\make.ps1 logs [frontend|backend|all] [--follow]

Common targets:
  help               Show this help
  install            Install backend and frontend npm dependencies
  setup-analysis-python Create backend/.venv with analysis Python dependencies
  dev-backend        Run backend in the foreground
  dev-frontend       Run frontend in the foreground
  build              Build backend and frontend
  db-init            Sync SQLite schema and seed data
  local-up           Start local stack, optionally starting redis if REDIS_URL is enabled
  local-up-noinfra   Start local stack without docker-managed infra
  local-down         Stop local processes and redis
  local-status       Show process state and health checks
  health             Run health checks only
  doctor             Native Windows preflight for SQLite local development
  start              Recommended SQLite local startup without Docker
  restart            Restart the SQLite local stack without Docker
  stop               Alias of local-down
  status             Alias of local-status
  logs               Show logs

Compatibility notes:
  - db-up/db-down and docker-up/docker-down call docker compose directly.
  - backend-regression and analysis-regression still require bash or WSL today.
'@ | Write-Host
}

Ensure-Directory $RuntimeDir
Ensure-Directory $LogDir
Ensure-Directory $PidDir
Ensure-FileFromExample -Path $EnvFile -ExamplePath $EnvExampleFile
$DotEnv = Load-DotEnv -Path $EnvFile

switch ($Target) {
  'help' { Show-Help }
  'install' {
    Require-Command 'npm' 'Install npm and retry.'
    Ensure-NpmDependencies -ProjectDir (Join-Path $RootDir 'backend') -ProjectName 'backend' -VersionChecks @('prisma', '@prisma/client')
    Ensure-NpmDependencies -ProjectDir (Join-Path $RootDir 'frontend') -ProjectName 'frontend' -VersionChecks @('next')
  }
  'setup-analysis-python' { Ensure-AnalysisVenv }
  'dev-backend' {
    & npm run dev --prefix (Join-Path $RootDir 'backend')
    exit $LASTEXITCODE
  }
  'dev-frontend' {
    $frontendPort = Get-ConfigValue -DotEnv $DotEnv -Name 'FRONTEND_PORT' -DefaultValue '30000'
    $env:FRONTEND_PORT = $frontendPort
    & npm run dev --prefix (Join-Path $RootDir 'frontend') -- --port $frontendPort
    exit $LASTEXITCODE
  }
  'build' {
    Invoke-BackendBuild
    Invoke-FrontendBuild
  }
  'db-up' {
    & docker compose -f (Join-Path $RootDir 'docker-compose.yml') up -d redis
    exit $LASTEXITCODE
  }
  'db-down' {
    & docker compose -f (Join-Path $RootDir 'docker-compose.yml') stop redis
    exit $LASTEXITCODE
  }
  'db-init' { Invoke-DbInit -DotEnv $DotEnv }
  'docker-up' {
    & docker compose -f (Join-Path $RootDir 'docker-compose.yml') up --build
    exit $LASTEXITCODE
  }
  'docker-down' {
    & docker compose -f (Join-Path $RootDir 'docker-compose.yml') down
    exit $LASTEXITCODE
  }
  'local-up' { Invoke-LocalUp -DotEnv $DotEnv }
  'local-up-uv' { Invoke-LocalUp -DotEnv $DotEnv }
  'local-up-noinfra' { Invoke-LocalUp -DotEnv $DotEnv -SkipInfra }
  'local-down' {
    Stop-TrackedService 'frontend'
    Stop-TrackedService 'backend'
    try {
      & docker compose -f (Join-Path $RootDir 'docker-compose.yml') stop redis *> $null
    }
    catch {
    }
    Write-Host 'Local stack stopped.'
  }
  'local-status' {
    Show-ServiceStatus 'backend'
    Show-ServiceStatus 'frontend'
    Write-Host ''
    Show-Health -DotEnv $DotEnv
  }
  'health' { Show-Health -DotEnv $DotEnv }
  'check-startup' { Invoke-Doctor -DotEnv $DotEnv }
  'backend-regression' {
    $bash = Get-CommandPath 'bash'
    if (-not $bash) {
      Fail 'backend-regression currently requires bash or WSL on Windows.'
    }
    & $bash (Join-Path $RootDir 'scripts/check-backend-regression.sh')
    exit $LASTEXITCODE
  }
  'analysis-regression' {
    $bash = Get-CommandPath 'bash'
    if (-not $bash) {
      Fail 'analysis-regression currently requires bash or WSL on Windows.'
    }
    & $bash (Join-Path $RootDir 'scripts/check-analysis-regression.sh')
    exit $LASTEXITCODE
  }
  'doctor' { Invoke-Doctor -DotEnv $DotEnv }
  'start' { Invoke-LocalUp -DotEnv $DotEnv -SkipInfra }
  'restart' {
    Stop-TrackedService 'frontend'
    Stop-TrackedService 'backend'
    Invoke-LocalUp -DotEnv $DotEnv -SkipInfra
  }
  'stop' {
    Stop-TrackedService 'frontend'
    Stop-TrackedService 'backend'
    try {
      & docker compose -f (Join-Path $RootDir 'docker-compose.yml') stop redis *> $null
    }
    catch {
    }
    Write-Host 'Local stack stopped.'
  }
  'status' {
    Show-ServiceStatus 'backend'
    Show-ServiceStatus 'frontend'
    Write-Host ''
    Show-Health -DotEnv $DotEnv
  }
  'logs' { Invoke-Logs -Args $RestArgs }
  'sclaw-install' {
    Fail 'sclaw-install is not implemented for native Windows yet. Use .\\make.ps1 directly.'
  }
  'up' {
    & docker compose -f (Join-Path $RootDir 'docker-compose.yml') up --build
    exit $LASTEXITCODE
  }
  default {
    Fail "Unknown target: $Target. Run .\\make.ps1 help"
  }
}
