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

  const { AnalysisEngineCatalogService } = await import('./backend/dist/services/analysis-engine.js');
  const { AgentSkillRuntime } = await import('./backend/dist/services/agent-skills/index.js');

  AgentSkillRuntime.prototype.listSkills = function mockListSkills() {
    return [
      {
        id: 'beam',
        structureType: 'beam',
        name: { zh: '梁', en: 'Beam' },
        description: { zh: 'beam', en: 'beam' },
        triggers: ['beam'],
        stages: ['intent', 'draft', 'analysis', 'design'],
        autoLoadByDefault: true,
        markdownByStage: {},
      },
      {
        id: 'truss',
        structureType: 'truss',
        name: { zh: '桁架', en: 'Truss' },
        description: { zh: 'truss', en: 'truss' },
        triggers: ['truss'],
        stages: ['intent', 'draft', 'analysis', 'design'],
        autoLoadByDefault: true,
        markdownByStage: {},
      },
    ];
  };

  AnalysisEngineCatalogService.prototype.listEngines = async function mockListEngines() {
    return {
      engines: [
        {
          id: 'engine-frame-a',
          name: 'Frame Engine A',
          enabled: true,
          available: true,
          status: 'available',
          supportedModelFamilies: ['frame'],
          supportedAnalysisTypes: ['static', 'dynamic'],
        },
        {
          id: 'engine-truss-a',
          name: 'Truss Engine A',
          enabled: true,
          available: true,
          status: 'available',
          supportedModelFamilies: ['truss'],
          supportedAnalysisTypes: ['static'],
        },
        {
          id: 'engine-generic',
          name: 'Generic Engine',
          enabled: true,
          available: true,
          status: 'available',
          supportedModelFamilies: ['generic'],
          supportedAnalysisTypes: ['static', 'dynamic', 'seismic', 'nonlinear'],
        },
        {
          id: 'engine-disabled',
          name: 'Disabled Engine',
          enabled: false,
          available: true,
          status: 'disabled',
          supportedModelFamilies: ['frame', 'truss', 'generic'],
          supportedAnalysisTypes: ['static'],
        },
      ],
    };
  };

  const { agentRoutes } = await import('./backend/dist/api/agent.js');

  const app = Fastify();
  await app.register(agentRoutes, { prefix: '/api/v1/agent' });

  const response = await app.inject({ method: 'GET', url: '/api/v1/agent/capability-matrix' });
  assert(response.statusCode === 200, 'capability matrix route should return 200');

  const payload = response.json();
  assert(typeof payload.generatedAt === 'string', 'payload.generatedAt should be present');
  assert(Array.isArray(payload.skills), 'payload.skills should be an array');
  assert(Array.isArray(payload.engines), 'payload.engines should be an array');
  assert(payload.validEngineIdsBySkill && typeof payload.validEngineIdsBySkill === 'object', 'validEngineIdsBySkill should be an object');
  assert(payload.filteredEngineReasonsBySkill && typeof payload.filteredEngineReasonsBySkill === 'object', 'filteredEngineReasonsBySkill should be an object');
  assert(payload.validSkillIdsByEngine && typeof payload.validSkillIdsByEngine === 'object', 'validSkillIdsByEngine should be an object');

  const engineIds = new Set(payload.engines.map((engine) => engine.id));
  const skillIds = new Set(payload.skills.map((skill) => skill.id));

  for (const skillId of skillIds) {
    assert(Array.isArray(payload.validEngineIdsBySkill[skillId]), `validEngineIdsBySkill should include array for ${skillId}`);
    for (const engineId of payload.validEngineIdsBySkill[skillId]) {
      assert(engineIds.has(engineId), `mapped engine ${engineId} should exist in engines list`);
      assert(Array.isArray(payload.validSkillIdsByEngine[engineId]), `reverse map should include engine ${engineId}`);
      assert(payload.validSkillIdsByEngine[engineId].includes(skillId), `reverse map for ${engineId} should include ${skillId}`);
    }
  }

  const beamEngines = payload.validEngineIdsBySkill.beam || [];
  const trussEngines = payload.validEngineIdsBySkill.truss || [];
  assert(beamEngines.includes('engine-frame-a'), 'beam should include frame-compatible engine');
  assert(beamEngines.includes('engine-generic'), 'beam should include generic engine');
  assert(!beamEngines.includes('engine-disabled'), 'beam should not include disabled engine');
  assert(trussEngines.includes('engine-truss-a'), 'truss should include truss-compatible engine');
  assert(trussEngines.includes('engine-generic'), 'truss should include generic engine');
  assert(payload.filteredEngineReasonsBySkill.beam['engine-truss-a'].includes('model_family_mismatch'), 'beam should mark truss engine as family mismatch');
  assert(payload.filteredEngineReasonsBySkill.beam['engine-disabled'].includes('engine_disabled'), 'beam should mark disabled engine reason');
  assert(payload.filteredEngineReasonsBySkill.truss['engine-frame-a'].includes('model_family_mismatch'), 'truss should mark frame engine as family mismatch');

  await app.close();
  console.log('[ok] agent capability matrix contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
