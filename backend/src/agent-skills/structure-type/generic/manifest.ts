import type { SkillManifest } from '../../../agent-runtime/types.js';

export const manifest: SkillManifest = {
  id: 'generic',
  structureType: 'unknown',
  name: {
    zh: '通用结构类型',
    en: 'Generic Structure Type',
  },
  description: {
    zh: '通用兜底的结构类型 skill。它不一定最强，但会先接住未命中的结构建模请求并引导后续技能与工具调用。',
    en: 'Generic fallback structure-type skill. It is not always the strongest, but it catches unmatched structural modeling requests and guides downstream skills and tools.',
  },
  triggers: ['structure', 'model', 'analysis', 'design', '结构', '模型', '分析', '设计', '荷载', 'load'],
  stages: ['intent', 'draft', 'analysis', 'design'],
  autoLoadByDefault: true,
  structuralTypeKeys: ['unknown', 'beam', 'truss', 'portal-frame', 'double-span-beam', 'frame', 'steel-frame'],
  domain: 'structure-type',
  requires: [],
  conflicts: [],
  capabilities: ['intent-detection', 'draft-extraction', 'interaction-questions', 'model-build', 'report-narrative', 'fallback-routing'],
  enabledTools: ['draft_model', 'update_model'],
  providedTools: [],
  priority: 5,
  compatibility: {
    minRuntimeVersion: '0.1.0',
    skillApiVersion: 'v1',
  },
};

export default manifest;
