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
  process.env.LLM_API_KEY = '';
  process.env.OPENAI_API_KEY = '';
  process.env.ZAI_API_KEY = '';
  process.env.LLM_PROVIDER = 'openai';
  const { AgentService } = await import('./backend/dist/services/agent.js');

  const svc = new AgentService();
  svc.structureProtocolClient = {
    post: async (path) => {
      if (path === '/validate') {
        return { data: { valid: true, schemaVersion: '1.0.0' } };
      }
      throw new Error(`unexpected structure protocol path ${path}`);
    },
  };
  svc.engineClient.post = async (path, payload) => {
    if (path === '/analyze') {
      return {
        data: {
          schema_version: '1.0.0',
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: 'ok',
          data: {
            envelope: {
              maxAbsDisplacement: 0.0123,
              maxAbsAxialForce: 123.4,
              maxAbsShearForce: 45.6,
              maxAbsMoment: 78.9,
              maxAbsReaction: 22.1,
              controlCase: {
                displacement: 'SLS',
                axialForce: 'ULS',
                shearForce: 'ULS',
                moment: 'ULS',
                reaction: 'SLS',
              },
              controlNodeDisplacement: 'N2',
              controlElementAxialForce: 'E1',
              controlElementShearForce: 'E1',
              controlElementMoment: 'E1',
              controlNodeReaction: 'N1',
            },
          },
          meta: {},
        },
      };
    }
    throw new Error(`unexpected analysis path ${path}`);
  };
  svc.codeCheckClient = {
    post: async (path, payload) => {
      if (path === '/code-check') {
        return {
          data: {
            code: payload.code,
            status: 'success',
            summary: { total: 1, passed: 1, failed: 0, warnings: 0 },
            details: [{
              elementId: 'E1',
              status: 'pass',
              checks: [{
                name: '强度验算',
                items: [{
                  item: '正应力',
                  clause: 'GB50017-2017 7.1.1',
                  formula: 'σ = N/A <= f',
                  utilization: 0.72,
                  status: 'pass',
                }],
              }],
            }],
          },
        };
      }
      throw new Error(`unexpected code-check path ${path}`);
    },
  };

  const result = await svc.run({
    message: '请分析并按规范校核后出报告',
    mode: 'execute',
    context: {
      model: {
        schema_version: '1.0.0',
        nodes: [{ id: '1', x: 0, y: 0, z: 0 }, { id: '2', x: 3, y: 0, z: 0 }],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
        materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
        sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } }],
        load_cases: [],
        load_combinations: [],
      },
      autoAnalyze: true,
      autoCodeCheck: true,
      designCode: 'GB50017',
      includeReport: true,
      reportFormat: 'both',
      reportOutput: 'inline',
    },
  });

  assert(result.success === true, 'run should succeed');
  assert(result.report?.json?.reportSchemaVersion === '1.0.0', 'report json should include schema version');
  assert(typeof result.report?.summary === 'string', 'report summary should exist');
  assert(result.report?.json?.keyMetrics?.maxAbsDisplacement === 0.0123, 'report key metrics should include displacement');
  assert(Array.isArray(result.report?.json?.clauseTraceability), 'report clause traceability should be array');
  assert(result.report?.json?.clauseTraceability?.[0]?.clause === 'GB50017-2017 7.1.1', 'report should include clause traceability row');
  assert(result.report?.json?.controllingCases?.batchControlCase?.axialForce === 'ULS', 'report should include controlling cases');
  assert(typeof result.report?.markdown === 'string', 'report markdown should exist');
  assert(result.report.markdown.includes('## 目录'), 'report markdown should include toc');
  assert(result.report.markdown.includes('## 关键指标'), 'report markdown should include key metrics section');
  assert(result.report.markdown.includes('## 条文追溯'), 'report markdown should include traceability section');
  assert(result.report.markdown.includes('## 控制工况'), 'report markdown should include controlling cases section');

  console.log('[ok] report template contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
