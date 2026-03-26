import { createAnalysisSkillManifest } from '../shared.js';

export const manifest = createAnalysisSkillManifest({
  id: 'opensees-seismic',
  name: {
    zh: 'OpenSees 抗震分析',
    en: 'OpenSees Seismic Analysis',
  },
  description: {
    zh: '使用 OpenSees 执行反应谱、Pushover 等抗震分析的 skill。',
    en: 'Skill for seismic response-spectrum and pushover analysis using OpenSees.',
  },
  software: 'opensees',
  analysisType: 'seismic',
  triggers: ['OpenSees 抗震分析', '反应谱分析', 'pushover', 'opensees seismic', 'response spectrum'],
  priority: 145,
});

export default manifest;
