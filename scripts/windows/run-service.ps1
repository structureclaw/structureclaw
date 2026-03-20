[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RootDir,

  [Parameter(Mandatory = $true)]
  [string]$LogFile,

  [Parameter(Mandatory = $true)]
  [string]$CommandText
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Set-Location $RootDir
$command = [scriptblock]::Create($CommandText)
& $command *>> $LogFile
exit $LASTEXITCODE
