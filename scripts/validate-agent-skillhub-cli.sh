#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build --prefix backend >/dev/null

node - <<'JS'
const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const run = async () => {
  const { execFile } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const runCli = (args, envExtra = {}) => new Promise((resolve, reject) => {
    execFile('bash', ['./scripts/claw.sh', 'skill', ...args], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        ...envExtra,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`CLI failed for ${args.join(' ')}: ${stderr || error.message}`));
        return;
      }
      resolve((stdout || '').trim());
    });
  });

  const parseCliJson = (raw, context) => {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      throw new Error(`CLI output is empty for ${context}`);
    }
    const firstJsonCharIndex = text.search(/[\[{]/);
    if (firstJsonCharIndex === -1) {
      throw new Error(`CLI output is not JSON for ${context}: ${text}`);
    }
    const jsonText = text.slice(firstJsonCharIndex);
    return JSON.parse(jsonText);
  };

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sclaw-skillhub-cli-'));
  const mockBinDir = path.join(tempRoot, 'bin');
  const stateFile = path.join(tempRoot, 'state.env');
  await fs.mkdir(mockBinDir, { recursive: true });
  await fs.writeFile(stateFile, 'installed=0\nenabled=0\n', 'utf-8');

  const mockCurlPath = path.join(mockBinDir, 'curl');
  await fs.writeFile(mockCurlPath, `#!/usr/bin/env bash
set -euo pipefail
state_file="${stateFile}"
if [[ -f "$state_file" ]]; then
  source "$state_file"
else
  installed=0
  enabled=0
fi
args="$*"

write_state() {
  printf 'installed=%s\nenabled=%s\n' "$installed" "$enabled" > "$state_file"
}

if [[ "$args" == *"/skillhub/search"* ]]; then
  if [[ "$installed" == "1" ]]; then
    echo '{"items":[{"id":"skillhub.seismic-simplified-policy","installed":true,"enabled":'"$enabled"'}],"total":1}'
  else
    echo '{"items":[{"id":"skillhub.seismic-simplified-policy","installed":false,"enabled":false}],"total":1}'
  fi
  exit 0
fi

if [[ "$args" == *"/skillhub/installed"* ]]; then
  if [[ "$installed" == "1" ]]; then
    echo '{"items":[{"id":"skillhub.seismic-simplified-policy","enabled":'"$enabled"'}]}'
  else
    echo '{"items":[]}'
  fi
  exit 0
fi

if [[ "$args" == *"/skillhub/install"* ]]; then
  installed=1
  enabled=1
  write_state
  echo '{"skillId":"skillhub.seismic-simplified-policy","installed":true,"enabled":true}'
  exit 0
fi

if [[ "$args" == *"/skillhub/disable"* ]]; then
  enabled=0
  write_state
  echo '{"skillId":"skillhub.seismic-simplified-policy","enabled":false}'
  exit 0
fi

if [[ "$args" == *"/skillhub/enable"* ]]; then
  enabled=1
  write_state
  echo '{"skillId":"skillhub.seismic-simplified-policy","enabled":true}'
  exit 0
fi

if [[ "$args" == *"/skillhub/uninstall"* ]]; then
  installed=0
  enabled=0
  write_state
  echo '{"skillId":"skillhub.seismic-simplified-policy","uninstalled":true}'
  exit 0
fi

echo '{}'`, 'utf-8');
  await fs.chmod(mockCurlPath, 0o755);

  const env = {
    SCLAW_API_BASE: 'http://mock.local',
    PATH: `${mockBinDir}:${process.env.PATH || ''}`,
  };

  const searchRaw = await runCli(['search', 'seismic'], env);
  const search = parseCliJson(searchRaw, 'skill search');
  assert(Array.isArray(search.items) && search.items.length > 0, 'search should return at least one item');
  const skillId = search.items[0].id;
  assert(typeof skillId === 'string' && skillId.length > 0, 'search result should provide skill id');

  const installRaw = await runCli(['install', skillId], env);
  const install = parseCliJson(installRaw, 'skill install');
  assert(install.installed === true, 'install should mark installed true');

  const listAfterInstallRaw = await runCli(['list'], env);
  const listAfterInstall = parseCliJson(listAfterInstallRaw, 'skill list after install');
  assert(Array.isArray(listAfterInstall.items), 'list should return items array');
  assert(listAfterInstall.items.some((item) => item.id === skillId), 'list should include installed skill');

  const disableRaw = await runCli(['disable', skillId], env);
  const disable = parseCliJson(disableRaw, 'skill disable');
  assert(disable.enabled === false, 'disable should set enabled=false');

  const enableRaw = await runCli(['enable', skillId], env);
  const enable = parseCliJson(enableRaw, 'skill enable');
  assert(enable.enabled === true, 'enable should set enabled=true');

  const uninstallRaw = await runCli(['uninstall', skillId], env);
  const uninstall = parseCliJson(uninstallRaw, 'skill uninstall');
  assert(uninstall.uninstalled === true, 'uninstall should remove skill');

  const listAfterUninstallRaw = await runCli(['list'], env);
  const listAfterUninstall = parseCliJson(listAfterUninstallRaw, 'skill list after uninstall');
  assert(!listAfterUninstall.items.some((item) => item.id === skillId), 'uninstalled skill should not remain in list');

  await fs.rm(tempRoot, { recursive: true, force: true });
  console.log('[ok] agent skillhub cli contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
