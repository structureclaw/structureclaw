import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'simplified-seismic',
  name: {
    zh: '简化抗震分析',
    en: 'Simplified Seismic Analysis',
  },
  description: {
    zh: '使用简化内置求解器执行轻量抗震分析的 skill。',
    en: 'Skill for lightweight seismic analysis using the simplified builtin solver.',
  },
  software: 'simplified',
  analysisType: 'seismic',
  triggers: ['简化抗震分析', '快速抗震分析', 'simplified seismic', 'lightweight seismic'],
  priority: 45,
});

export default manifest;
