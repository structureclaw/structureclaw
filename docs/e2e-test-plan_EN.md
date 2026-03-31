# StructureClaw End-to-End Test Plan

## Goal

Verify that installation, `sclaw`, and Docker Compose workflows work correctly on clean environments (including Windows).

---

## Option 1: GitHub Actions (Recommended — aligned with repo CI)

The repository runs tests via [`.github/workflows/install-smoke.yml`](../.github/workflows/install-smoke.yml):

- **`smoke-native`**: `node tests/runner.mjs smoke-native` (Ubuntu + `windows-latest` matrix, equivalent to `npm ci` + build).
- **`smoke-docker`**: `node tests/runner.mjs smoke-docker` (Linux; a self-hosted Windows job runs the same command once Docker is ready).

Commands aligned with local/docs:

```bash
node tests/runner.mjs smoke-native
node tests/runner.mjs smoke-docker
```

The root `package.json` also provides aliases: `npm run smoke:native`, `npm run smoke:docker`.

### Limitations

- GitHub-hosted Windows runners come with Docker Desktop pre-installed; this cannot cover the first-time experience of a machine without Docker.
- Self-hosted Windows runners must ensure Docker is available independently.

---

## Option 2: Windows Sandbox (Local Testing)

### Advantages

- Lightweight; starts from a clean environment every time
- Supports Windows 10/11 Pro/Enterprise
- Full control over the installation process

### Steps

1. Create a `test-sandbox.wsb` that maps the repository into the sandbox (adjust `HostFolder` as needed).
2. After cloning or mapping the code inside the sandbox, run the same validation commands as CI in PowerShell:

```powershell
Set-Location C:\path\to\structureclaw
node tests\runner.mjs smoke-native
# If Docker is installed:
node tests\runner.mjs smoke-docker
```

### Limitations

- Requires Windows Pro/Enterprise
- Virtualization must be enabled in BIOS
- If Docker is not pre-installed inside the sandbox, install it first before running `smoke-docker`

---

## Option 3: Hyper-V Virtual Machine (Full Testing)

### Advantages

- Complete control over the test environment
- Can test all scenarios (including no Docker)
- Supports snapshot-based rollback

### Steps

1. Create a Windows 11 VM template.
2. Install PowerShell 7 and Node.js.
3. Inside the VM, run the same `node tests/runner.mjs smoke-native` / `smoke-docker` commands as in Option 1, or use the following example to exercise `sclaw docker-install` directly inside the VM:

```powershell
# test-vm.ps1 (sample snippet)
param(
  [string]$VMName = "StructureClaw-Test"
)

Checkpoint-VM -Name $VMName -SnapshotName "BeforeTest"
# ... after syncing the repository into the VM ...
Invoke-Command -VMName $VMName -ScriptBlock {
  Set-Location C:\Test
  node .\sclaw docker-install --non-interactive --llm-provider openai --llm-base-url https://api.openai.com/v1 --llm-api-key test-key --llm-model gpt-4.1 --skip-api-test
}
Restore-VMSnapshot -VMName $VMName -Name "BeforeTest"
```

---

## Option 4: Regression & Contract Validation (Code Level)

CLI and backend deep validation is performed via `tests/runner.mjs`:

```bash
node tests/runner.mjs analysis-regression
node tests/runner.mjs check backend-regression
node tests/runner.mjs validate --list
```

See the **Build, Run, and Verify** section in root [AGENTS.md](../AGENTS.md) for details.

---

## Recommended Combination Strategy

| Test Type | Tool | Trigger | Purpose |
|-----------|------|---------|---------|
| Install & build smoke | `install-smoke.yml` / `smoke-native` | PR / Push (path-triggered) | Verify cross-platform `npm ci` + build |
| Docker smoke | `install-smoke.yml` / `smoke-docker` | PR / Push | Verify Compose and stack start/stop |
| Regression & contract | `tests/runner.mjs` | Local or corresponding workflow | Analysis runtime, API contracts, etc. |
| End-to-end (optional) | Windows Sandbox / Hyper-V | Before release or major install changes | Close to real user environment |

---

## Next Steps (Optional)

1. Keep Docker and Node versions on self-hosted Windows runners consistent with documentation.
2. When needed, supplement `tests/README.md` or other documentation in the repository with smoke and regression entry-point descriptions.
