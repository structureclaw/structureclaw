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
  const { AgentSkillRuntime } = await import('./backend/dist/agent-skills/runtime/index.js');

  AgentSkillRuntime.prototype.listSkillManifests = async function mockListSkillManifests() {
    return [
      {
        id: 'beam',
        structureType: 'beam',
        domain: 'structure-type',
        name: { zh: '梁', en: 'Beam' },
        description: { zh: 'beam', en: 'beam' },
        triggers: ['beam'],
        stages: ['intent', 'draft', 'analysis', 'design'],
        autoLoadByDefault: true,
        scenarioKeys: ['beam'],
        requires: [],
        conflicts: [],
        capabilities: ['intent-detection'],
        priority: 10,
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
      },
      {
        id: 'truss',
        structureType: 'truss',
        domain: 'structure-type',
        name: { zh: '桁架', en: 'Truss' },
        description: { zh: 'truss', en: 'truss' },
        triggers: ['truss'],
        stages: ['intent', 'draft', 'analysis', 'design'],
        autoLoadByDefault: true,
        scenarioKeys: ['truss'],
        requires: [],
        conflicts: [],
        capabilities: ['intent-detection'],
        priority: 20,
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
      },
      {
        id: 'analysis-strategy-baseline',
        structureType: 'beam',
        domain: 'analysis-strategy',
        name: { zh: '分析策略基线', en: 'Analysis Strategy Baseline' },
        description: { zh: 'analysis strategy', en: 'analysis strategy' },
        triggers: ['analysis'],
        stages: ['analysis'],
        autoLoadByDefault: true,
        scenarioKeys: ['beam'],
        requires: [],
        conflicts: [],
        capabilities: ['analysis-policy'],
        supportedAnalysisTypes: ['static', 'dynamic'],
        priority: 5,
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
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
  assert(Array.isArray(payload.domainSummaries), 'payload.domainSummaries should be an array');
  assert(payload.validEngineIdsBySkill && typeof payload.validEngineIdsBySkill === 'object', 'validEngineIdsBySkill should be an object');
  assert(payload.filteredEngineReasonsBySkill && typeof payload.filteredEngineReasonsBySkill === 'object', 'filteredEngineReasonsBySkill should be an object');
  assert(payload.validSkillIdsByEngine && typeof payload.validSkillIdsByEngine === 'object', 'validSkillIdsByEngine should be an object');
  assert(payload.skillDomainById && typeof payload.skillDomainById === 'object', 'skillDomainById should be an object');
  assert(payload.analysisStrategyCompatibility && typeof payload.analysisStrategyCompatibility === 'object', 'analysisStrategyCompatibility should be an object');

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
  assert(payload.skillDomainById.beam === 'structure-type', 'beam should have structure-type domain mapping');
  assert(payload.skillDomainById.truss === 'structure-type', 'truss should have structure-type domain mapping');
  assert(beamEngines.includes('engine-frame-a'), 'beam should include frame-compatible engine');
  assert(beamEngines.includes('engine-generic'), 'beam should include generic engine');
  assert(!beamEngines.includes('engine-disabled'), 'beam should not include disabled engine');
  assert(trussEngines.includes('engine-truss-a'), 'truss should include truss-compatible engine');
  assert(trussEngines.includes('engine-generic'), 'truss should include generic engine');
  assert(payload.filteredEngineReasonsBySkill.beam['engine-truss-a'].includes('model_family_mismatch'), 'beam should mark truss engine as family mismatch');
  assert(payload.filteredEngineReasonsBySkill.beam['engine-disabled'].includes('engine_disabled'), 'beam should mark disabled engine reason');
  assert(payload.filteredEngineReasonsBySkill.truss['engine-frame-a'].includes('model_family_mismatch'), 'truss should mark frame engine as family mismatch');
  assert(Array.isArray(payload.analysisStrategyCompatibility.static.strategySkillIds), 'static strategy skill IDs should be an array');
  assert(payload.analysisStrategyCompatibility.static.strategySkillIds.includes('analysis-strategy-baseline'), 'static strategy should include baseline strategy skill');
  assert(payload.analysisStrategyCompatibility.dynamic.strategySkillIds.includes('analysis-strategy-baseline'), 'dynamic strategy should include baseline strategy skill');
  assert(!payload.analysisStrategyCompatibility.seismic.strategySkillIds.includes('analysis-strategy-baseline'), 'seismic strategy should exclude unsupported strategy skill');
  assert(payload.analysisStrategyCompatibility.static.baselinePolicyAvailable === true, 'baseline policy should be available for static');

  const responseDynamic = await app.inject({ method: 'GET', url: '/api/v1/agent/capability-matrix?analysisType=dynamic' });
  assert(responseDynamic.statusCode === 200, 'analysisType-specific capability matrix route should return 200');
  const dynamicPayload = responseDynamic.json();
  assert(dynamicPayload.appliedAnalysisType === 'dynamic', 'payload should echo applied analysis type');
  assert(dynamicPayload.filteredEngineReasonsBySkill.truss['engine-truss-a'].includes('analysis_type_mismatch'), 'dynamic matrix should mark analysis type mismatch for static-only truss engine');

  await app.close();
  console.log('[ok] agent capability matrix contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
