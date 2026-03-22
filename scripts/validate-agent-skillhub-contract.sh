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
  const { createRequire } = await import('node:module');
  const require = createRequire(process.cwd() + '/backend/package.json');
  const Fastify = require('fastify');
  const fs = await import('node:fs/promises');
  const stateFile = './.runtime/skillhub/installed.json';
  const cacheFile = './.runtime/skillhub/cache.json';

  await fs.rm('./.runtime/skillhub', { recursive: true, force: true });

  const { agentRoutes } = await import('./backend/dist/api/agent.js');
  const app = Fastify();
  await app.register(agentRoutes, { prefix: '/api/v1/agent' });

  const searchResp = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/skillhub/search?q=seismic',
  });
  assert(searchResp.statusCode === 200, 'search should return 200');
  const searchPayload = searchResp.json();
  assert(Array.isArray(searchPayload.items), 'search should return items array');
  assert(searchPayload.items.length >= 1, 'search should return matching items');

  const targetSkillId = searchPayload.items[0].id;
  assert(typeof targetSkillId === 'string' && targetSkillId.length > 0, 'search item should include id');

  const installResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/install',
    payload: { skillId: targetSkillId },
  });
  assert(installResp.statusCode === 200, 'install should return 200');
  const installPayload = installResp.json();
  assert(installPayload.installed === true, 'install response should indicate installed');

  const listResp = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/skillhub/installed',
  });
  assert(listResp.statusCode === 200, 'installed list should return 200');
  const listPayload = listResp.json();
  assert(Array.isArray(listPayload.items), 'installed list should include items array');
  assert(listPayload.items.some((item) => item.id === targetSkillId), 'installed list should include installed skill');

  const disableResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/disable',
    payload: { skillId: targetSkillId },
  });
  assert(disableResp.statusCode === 200, 'disable should return 200');
  assert(disableResp.json().enabled === false, 'disable should set enabled=false');

  const enableResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/enable',
    payload: { skillId: targetSkillId },
  });
  assert(enableResp.statusCode === 200, 'enable should return 200');
  assert(enableResp.json().enabled === true, 'enable should set enabled=true');

  const uninstallResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/uninstall',
    payload: { skillId: targetSkillId },
  });
  assert(uninstallResp.statusCode === 200, 'uninstall should return 200');
  assert(uninstallResp.json().uninstalled === true, 'uninstall should remove installed skill');

  const listAfterResp = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/skillhub/installed',
  });
  const listAfter = listAfterResp.json();
  assert(!listAfter.items.some((item) => item.id === targetSkillId), 'uninstalled skill should not appear in installed list');

  const incompatibleSearchResp = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/skillhub/search?q=future-runtime-only',
  });
  assert(incompatibleSearchResp.statusCode === 200, 'incompatible search should return 200');
  const incompatibleSearchPayload = incompatibleSearchResp.json();
  const incompatibleSkill = incompatibleSearchPayload.items.find((item) => item.id === 'skillhub.future-runtime-only');
  assert(Boolean(incompatibleSkill), 'future-runtime-only skill should exist in catalog');
  assert(incompatibleSkill.compatibility.compatible === false, 'future-runtime-only should be incompatible');
  assert(incompatibleSkill.compatibility.reasonCodes.includes('runtime_version_incompatible'), 'future-runtime-only should report runtime version incompatibility');
  assert(incompatibleSkill.compatibility.reasonCodes.includes('skill_api_version_incompatible'), 'future-runtime-only should report skill api incompatibility');

  const incompatibleInstallResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/install',
    payload: { skillId: 'skillhub.future-runtime-only' },
  });
  assert(incompatibleInstallResp.statusCode === 200, 'incompatible install should return 200');
  const incompatibleInstallPayload = incompatibleInstallResp.json();
  assert(incompatibleInstallPayload.installed === true, 'incompatible skill should still install');
  assert(incompatibleInstallPayload.enabled === false, 'incompatible skill should auto-disable after install');
  assert(incompatibleInstallPayload.fallbackBehavior === 'baseline_only', 'incompatible skill should declare baseline fallback');
  assert(incompatibleInstallPayload.compatibilityStatus === 'incompatible', 'incompatible install should return incompatible status');

  const incompatibleEnableResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/enable',
    payload: { skillId: 'skillhub.future-runtime-only' },
  });
  assert(incompatibleEnableResp.statusCode === 200, 'incompatible enable should return 200');
  const incompatibleEnablePayload = incompatibleEnableResp.json();
  assert(incompatibleEnablePayload.enabled === false, 'incompatible enable should remain disabled');
  assert(incompatibleEnablePayload.fallbackBehavior === 'baseline_only', 'incompatible enable should keep baseline fallback');

  const badSignatureInstallResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/install',
    payload: { skillId: 'skillhub.bad-signature-pack' },
  });
  assert(badSignatureInstallResp.statusCode === 200, 'bad signature install should return 200');
  const badSignaturePayload = badSignatureInstallResp.json();
  assert(badSignaturePayload.installed === false, 'bad signature skill should not install');
  assert(badSignaturePayload.integrityStatus === 'rejected', 'bad signature should be rejected');
  assert(badSignaturePayload.integrityReasonCodes.includes('signature_invalid'), 'bad signature should report signature_invalid');

  const badChecksumInstallResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/install',
    payload: { skillId: 'skillhub.bad-checksum-pack' },
  });
  assert(badChecksumInstallResp.statusCode === 200, 'bad checksum install should return 200');
  const badChecksumPayload = badChecksumInstallResp.json();
  assert(badChecksumPayload.installed === false, 'bad checksum skill should not install');
  assert(badChecksumPayload.integrityStatus === 'rejected', 'bad checksum should be rejected');
  assert(badChecksumPayload.integrityReasonCodes.includes('checksum_mismatch'), 'bad checksum should report checksum_mismatch');

  await fs.mkdir('./.runtime/skillhub', { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify({
    skills: {
      'skillhub.cached-only-pack': {
        id: 'skillhub.cached-only-pack',
        version: '1.0.0',
        domain: 'report-export',
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
        integrity: {
          checksum: '4f9beaa82c00cb7d4c679020ac6f5021536b9b5b13b7be2ad55e872fe414d2f4',
          signature: 'sig:skillhub.cached-only-pack:1.0.0',
        },
      },
    },
  }, null, 2), 'utf-8');

  process.env.SCLAW_SKILLHUB_OFFLINE = 'true';
  const offlineInstallResp = await app.inject({
    method: 'POST',
    url: '/api/v1/agent/skillhub/install',
    payload: { skillId: 'skillhub.cached-only-pack' },
  });
  assert(offlineInstallResp.statusCode === 200, 'offline cache install should return 200');
  const offlineInstallPayload = offlineInstallResp.json();
  assert(offlineInstallPayload.installed === true, 'offline cache install should succeed');
  assert(offlineInstallPayload.reusedFromCache === true, 'offline cache install should indicate cache reuse');
  process.env.SCLAW_SKILLHUB_OFFLINE = 'false';

  await app.close();
  await fs.rm('./.runtime/skillhub', { recursive: true, force: true });
  console.log('[ok] agent skillhub contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
