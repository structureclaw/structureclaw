import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'opensees-nonlinear',
  name: {
    zh: 'OpenSees 非线性分析',
    en: 'OpenSees Nonlinear Analysis',
  },
  description: {
    zh: '面向 OpenSees 非线性分析需求识别与路由的 skill。',
    en: 'Skill for recognizing and routing OpenSees nonlinear analysis requests.',
  },
  software: 'opensees',
  analysisType: 'nonlinear',
  triggers: ['OpenSees 非线性分析', '非线性分析', '材料非线性', 'opensees nonlinear', 'nonlinear analysis'],
  priority: 160,
});

export default manifest;
