import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'opensees-dynamic',
  name: {
    zh: 'OpenSees 动力分析',
    en: 'OpenSees Dynamic Analysis',
  },
  description: {
    zh: '使用 OpenSees 执行模态或时程动力分析的 skill。',
    en: 'Skill for modal and time-history dynamic analysis using OpenSees.',
  },
  software: 'opensees',
  analysisType: 'dynamic',
  triggers: ['OpenSees 动力分析', '模态分析', '时程分析', 'opensees dynamic', 'modal analysis', 'time history'],
  priority: 150,
});

export default manifest;
