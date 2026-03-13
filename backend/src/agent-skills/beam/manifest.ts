import type { SkillManifest } from '../../services/agent-skills/types.js';

export const manifest: SkillManifest = {
  id: 'beam',
  structureType: 'beam',
  name: {
    zh: '梁',
    en: 'Beam',
  },
  description: {
    zh: '单跨梁或悬臂梁的需求识别与补参 skill。',
    en: 'Skill for beam or cantilever intent detection and clarification.',
  },
  triggers: ['beam', '梁', '悬臂', 'girder', '主梁', '大梁'],
  stages: ['intent', 'draft', 'analysis', 'design'],
  autoLoadByDefault: true,
  scenarioKeys: ['beam', 'girder'],
  priority: 40,
};

export default manifest;
