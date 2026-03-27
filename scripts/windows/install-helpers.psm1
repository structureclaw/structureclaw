# Shared helpers for StructureClaw install.ps1 (unit-tested via Pester).

Set-StrictMode -Version Latest

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
  Set-Content -LiteralPath $OutputPath -Value $content -NoNewline
}

Export-ModuleMember -Function @('Get-EnvPort', 'New-EnvFile')
