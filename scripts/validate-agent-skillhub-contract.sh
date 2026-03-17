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

  await app.close();
  await fs.rm('./.runtime/skillhub', { recursive: true, force: true });
  console.log('[ok] agent skillhub contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
