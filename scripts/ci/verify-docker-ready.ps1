[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$maxAttempts = 30
$attempt = 0

Write-Host 'Waiting for Docker...'

while ($attempt -lt $maxAttempts) {
  try {
    $result = & docker version --format '{{.Server.Os}}/{{.Server.Arch}} {{.Server.Version}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($result)) {
      Write-Host "Docker is ready: $result" -ForegroundColor Green
      exit 0
    }
  } catch {
    # Docker may not be ready yet.
  }

  $attempt++
  Start-Sleep -Seconds 5
}

Write-Error 'Docker failed to start'
exit 1
