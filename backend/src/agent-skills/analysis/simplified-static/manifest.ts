import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'simplified-static',
  name: {
    zh: '简化静力分析',
    en: 'Simplified Static Analysis',
  },
  description: {
    zh: '使用简化内置求解器执行快速静力分析的 skill。',
    en: 'Skill for fast static analysis using the simplified builtin solver.',
  },
  software: 'simplified',
  analysisType: 'static',
  triggers: ['简化静力分析', '快速静力分析', 'simplified static', 'fast static analysis'],
  priority: 40,
});

export default manifest;
