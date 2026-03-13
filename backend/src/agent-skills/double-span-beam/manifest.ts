import type { SkillManifest } from '../../services/agent-skills/types.js';

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
  scenarioKeys: ['double-span-beam'],
  priority: 90,
};

export default manifest;
