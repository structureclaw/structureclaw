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

  const { agentRoutes } = await import('./backend/dist/api/agent.js');
  const app = Fastify();
  await app.register(agentRoutes, { prefix: '/api/v1/agent' });

  const resp = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/tools',
  });
  assert(resp.statusCode === 200, 'agent/tools should return 200');

  const payload = resp.json();
  assert(payload.version === '2.0.0', 'protocol version should be 2.0.0');
  assert(Array.isArray(payload.tools), 'tools should be array');

  const toolNames = payload.tools.map((t) => t.name);
  const requiredTools = [
    'text-to-model-draft',
    'convert',
    'validate',
    'analyze',
    'code-check',
    'report',
  ];
  for (const name of requiredTools) {
    assert(toolNames.includes(name), `missing required tool: ${name}`);
  }

  const requestContext = payload.runRequestSchema?.properties?.context?.properties || {};
  assert(payload.runRequestSchema?.properties?.traceId?.type === 'string', 'runRequestSchema should include traceId');
  assert(requestContext.reportOutput?.enum?.includes('file'), 'runRequestSchema should include reportOutput=file');
  assert(requestContext.reportFormat?.enum?.includes('both'), 'runRequestSchema should include reportFormat=both');

  const reportTool = payload.tools.find((t) => t.name === 'report');
  assert(reportTool, 'report tool spec should exist');
  assert(reportTool.inputSchema?.required?.includes('analysis'), 'report tool input should require analysis');
  assert(reportTool.outputSchema?.properties?.json?.type === 'object', 'report output should include json object');

  const runResult = payload.runResultSchema?.properties || {};
  assert(runResult.startedAt?.type === 'string', 'runResultSchema should include startedAt');
  assert(runResult.completedAt?.type === 'string', 'runResultSchema should include completedAt');
  assert(runResult.artifacts?.type === 'array', 'runResultSchema should include artifacts array');
  assert(runResult.metrics?.type === 'object', 'runResultSchema should include metrics object');
  assert(runResult.metrics?.properties?.totalToolDurationMs?.type === 'number', 'metrics should include totalToolDurationMs');
  assert(runResult.metrics?.properties?.toolDurationMsByName?.type === 'object', 'metrics should include toolDurationMsByName');

  await app.close();
  console.log('[ok] agent tools protocol contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
