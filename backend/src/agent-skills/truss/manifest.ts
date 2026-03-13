import type { SkillManifest } from '../../services/agent-skills/types.js';

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
  priority: 80,
};

export default manifest;
