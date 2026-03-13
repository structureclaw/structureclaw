import type { SkillManifest } from '../../services/agent-skills/types.js';

export const manifest: SkillManifest = {
  id: 'frame',
  structureType: 'frame',
  name: {
    zh: '规则框架',
    en: 'Regular Frame',
  },
  description: {
    zh: '规则平面/空间框架需求识别与补参 skill。',
    en: 'Skill for regular 2D/3D frame intent detection and parameter clarification.',
  },
  triggers: ['frame', '框架', 'steel frame', '钢框架', 'moment frame', '刚接框架'],
  stages: ['intent', 'draft', 'analysis', 'design'],
  autoLoadByDefault: true,
  scenarioKeys: ['frame', 'steel-frame'],
  priority: 70,
};

export default manifest;
