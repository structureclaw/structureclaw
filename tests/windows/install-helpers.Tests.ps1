# Pester 5 tests for scripts/windows/install-helpers.psm1

BeforeAll {
  $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $script:EnvExamplePath = Join-Path $script:RepoRoot '.env.example'
  $script:ModulePath = Join-Path $script:RepoRoot 'scripts\windows\install-helpers.psm1'
  Import-Module -Name $script:ModulePath -Force
}

Describe 'Get-EnvPort' {
  It 'returns default when env file is missing' {
    $missing = Join-Path $TestDrive 'no-such.env'
    Get-EnvPort -EnvPath $missing -VarName 'PORT' -DefaultPort '30010' | Should -Be '30010'
  }

  It 'returns default when variable is absent' {
    $f = Join-Path $TestDrive '.env'
    Set-Content -LiteralPath $f -Value "OTHER=1`n"
    Get-EnvPort -EnvPath $f -VarName 'PORT' -DefaultPort '30010' | Should -Be '30010'
  }

  It 'parses numeric PORT from env file' {
    $f = Join-Path $TestDrive '.env'
    Set-Content -LiteralPath $f -Value "PORT=9999`n"
    Get-EnvPort -EnvPath $f -VarName 'PORT' -DefaultPort '1' | Should -Be '9999'
  }

  It 'parses FRONTEND_PORT when multiple lines exist' {
    $f = Join-Path $TestDrive '.env'
    Set-Content -LiteralPath $f -Value @(
      'PORT=30010'
      'FRONTEND_PORT=30001'
    )
    Get-EnvPort -EnvPath $f -VarName 'FRONTEND_PORT' -DefaultPort '30000' | Should -Be '30001'
  }
}

Describe 'New-EnvFile' {
  It 'throws when template is missing' {
    $tpl = Join-Path $TestDrive 'missing.example'
    $out = Join-Path $TestDrive '.env'
    { New-EnvFile -TemplatePath $tpl -OutputPath $out -BaseUrl 'https://x' -ApiKey 'k' -Model 'm' -Provider 'openai' } |
      Should -Throw
  }

  It 'generates .env from .env.example with LLM fields replaced' {
    $tpl = Join-Path $TestDrive 'template'
    Copy-Item -LiteralPath $script:EnvExamplePath -Destination $tpl
    $out = Join-Path $TestDrive '.env'
    New-EnvFile -TemplatePath $tpl -OutputPath $out `
      -BaseUrl 'https://api.example.com/v1' `
      -ApiKey 'secret-key' `
      -Model 'test-model' `
      -Provider 'openai-compatible'

    Test-Path -LiteralPath $out | Should -Be $true
    $text = Get-Content -LiteralPath $out -Raw
    $text | Should -Match 'LLM_PROVIDER=openai-compatible'
    $text | Should -Match 'LLM_API_KEY=secret-key'
    $text | Should -Match 'LLM_MODEL=test-model'
    $text | Should -Match 'LLM_BASE_URL=https://api.example.com/v1'
  }
}
