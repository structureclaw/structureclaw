[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Target = "help",

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$RestArgs
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SclawEntry = Join-Path $RootDir "sclaw"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Missing required command: node`nInstall Node.js 18+ and retry."
}

if (-not (Test-Path -LiteralPath $SclawEntry)) {
  throw "Cannot find sclaw entry at $SclawEntry"
}

& node $SclawEntry $Target @RestArgs
exit $LASTEXITCODE
