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
  process.env.SCLAW_SKILLHUB_FORCE_DOWN = 'true';

  const { createRequire } = await import('node:module');
  const require = createRequire(process.cwd() + '/backend/package.json');
  const Fastify = require('fastify');

  const { agentRoutes } = await import('./backend/dist/api/agent.js');
  const { AgentService } = await import('./backend/dist/services/agent.js');

  const app = Fastify();
  await app.register(agentRoutes, { prefix: '/api/v1/agent' });

  const searchResp = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/skillhub/search?q=beam',
  });
  assert(searchResp.statusCode >= 500, 'skillhub search should fail when repository is forced down');

  const svc = new AgentService();
  svc.engineClient.post = async (path, payload) => {
    if (path === '/validate') {
      return { data: { valid: true, schemaVersion: '1.0.0' } };
    }
    if (path === '/analyze') {
      return {
        data: {
          schema_version: '1.0.0',
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: 'ok',
          data: {},
          meta: {},
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  };

  const result = await svc.run({
    message: '按3m悬臂梁端部10kN点荷载做静力分析',
    mode: 'execute',
    context: {
      skillIds: [],
      userDecision: 'allow_auto_decide',
      autoCodeCheck: false,
      includeReport: false,
      locale: 'zh',
    },
  });

  assert(result.success === true, 'baseline execute should still succeed when repository is down');
  assert(result.toolCalls.some((item) => item.tool === 'analyze' && item.status === 'success'), 'analyze should still run in baseline mode');

  await app.close();
  process.env.SCLAW_SKILLHUB_FORCE_DOWN = 'false';
  console.log('[ok] skillhub repository-down fallback contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
