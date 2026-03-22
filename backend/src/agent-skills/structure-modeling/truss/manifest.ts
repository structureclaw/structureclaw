import type { SkillManifest } from '../../../agent-skills/runtime/types.js';

export const manifest: SkillManifest = {
  id: 'truss',
  structureType: 'truss',
  name: {
    zh: '桁架',
    en: 'Truss',
  },
  description: {
    zh: '平面桁架的需求识别与补参 skill。',
    en: 'Skill for planar truss intent detection and clarification.',
  },
  triggers: ['truss', '桁架'],
  stages: ['intent', 'draft', 'analysis', 'design'],
  autoLoadByDefault: true,
  scenarioKeys: ['truss'],
  domain: 'structure-type',
  requires: [],
  conflicts: [],
  capabilities: ['intent-detection', 'draft-extraction', 'interaction-questions', 'model-build', 'report-narrative'],
  priority: 80,
  compatibility: {
    minRuntimeVersion: '0.1.0',
    skillApiVersion: 'v1',
  },
};

export default manifest;
