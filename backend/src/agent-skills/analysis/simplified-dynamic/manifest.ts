import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'simplified-dynamic',
  name: {
    zh: '简化动力分析',
    en: 'Simplified Dynamic Analysis',
  },
  description: {
    zh: '使用简化内置求解器执行轻量动力分析的 skill。',
    en: 'Skill for lightweight dynamic analysis using the simplified builtin solver.',
  },
  software: 'simplified',
  analysisType: 'dynamic',
  triggers: ['简化动力分析', '快速模态分析', 'simplified dynamic', 'lightweight dynamic'],
  priority: 50,
});

export default manifest;
