import type { SkillManifest } from '../../../agent-skills/runtime/types.js';

export const manifest: SkillManifest = {
  id: 'portal-frame',
  structureType: 'portal-frame',
  name: {
    zh: '门式刚架',
    en: 'Portal Frame',
  },
  description: {
    zh: '门式刚架需求识别与补参 skill。',
    en: 'Skill for portal-frame intent detection and clarification.',
  },
  triggers: ['portal frame', '门式刚架', 'portal', '门架', '刚架'],
  stages: ['intent', 'draft', 'analysis', 'design'],
  autoLoadByDefault: true,
  scenarioKeys: ['portal-frame', 'portal'],
  domain: 'structure-type',
  requires: [],
  conflicts: [],
  capabilities: ['intent-detection', 'draft-extraction', 'interaction-questions', 'model-build', 'report-narrative'],
  priority: 100,
  compatibility: {
    minRuntimeVersion: '0.1.0',
    skillApiVersion: 'v1',
  },
};

export default manifest;
