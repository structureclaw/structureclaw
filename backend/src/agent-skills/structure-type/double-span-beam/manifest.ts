import type { SkillManifest } from '../../../agent-runtime/types.js';

export const manifest: SkillManifest = {
  id: 'double-span-beam',
  structureType: 'double-span-beam',
  name: {
    zh: '双跨梁',
    en: 'Double-Span Beam',
  },
  description: {
    zh: '双跨梁需求识别与补参 skill。',
    en: 'Skill for double-span beam intent detection and clarification.',
  },
  triggers: ['double-span', '双跨梁'],
  stages: ['intent', 'draft', 'analysis', 'design'],
  autoLoadByDefault: true,
  structuralTypeKeys: ['double-span-beam'],
  domain: 'structure-type',
  requires: [],
  conflicts: [],
  capabilities: ['intent-detection', 'draft-extraction', 'interaction-questions', 'model-build', 'report-narrative'],
  enabledTools: ['draft_model', 'update_model'],
  priority: 90,
  compatibility: {
    minRuntimeVersion: '0.1.0',
    skillApiVersion: 'v1',
  },
};

export default manifest;
