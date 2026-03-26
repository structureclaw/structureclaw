import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'opensees-static',
  name: {
    zh: 'OpenSees 静力分析',
    en: 'OpenSees Static Analysis',
  },
  description: {
    zh: '使用 OpenSees 执行静力/线弹性分析的 skill。',
    en: 'Skill for static and linear-elastic analysis using OpenSees.',
  },
  software: 'opensees',
  analysisType: 'static',
  triggers: ['OpenSees 静力分析', '静力分析', '线性静力', 'opensees static', 'static analysis'],
  priority: 140,
});

export default manifest;
