import { listBuiltinAnalysisSkills } from '../agent-skills/analysis/entry.js';
import { listCodeCheckRuleProviders } from '../agent-skills/code-check/entry.js';
import type { SkillManifest } from './types.js';

const DEFAULT_COMPATIBILITY = {
  minRuntimeVersion: '0.1.0',
  skillApiVersion: 'v1',
} as const;

const GENERIC_STRUCTURAL_TYPE_KEYS: SkillManifest['structuralTypeKeys'] = [];
const GENERIC_MODEL_FAMILIES = ['generic'] as const;

function createGenericDomainManifest(
  manifest: Omit<SkillManifest, 'structureType' | 'structuralTypeKeys' | 'compatibility'>,
): SkillManifest {
  return {
    ...manifest,
    structureType: 'unknown',
    structuralTypeKeys: [...GENERIC_STRUCTURAL_TYPE_KEYS],
    compatibility: { ...DEFAULT_COMPATIBILITY },
  };
}

function buildAnalysisManifests(): SkillManifest[] {
  return listBuiltinAnalysisSkills().map((skill) => createGenericDomainManifest({
    id: skill.id,
    domain: 'analysis',
    name: skill.name,
    description: skill.description,
    triggers: [...skill.triggers],
    stages: [...skill.stages],
    autoLoadByDefault: false,
    requires: [],
    conflicts: [],
    capabilities: [...skill.capabilities],
    enabledTools: ['run_analysis'],
    supportedAnalysisTypes: [skill.analysisType],
    supportedModelFamilies: [...skill.supportedModelFamilies],
    priority: skill.priority,
  }));
}

function buildCodeCheckManifests(): SkillManifest[] {
  return listCodeCheckRuleProviders().map((provider) => createGenericDomainManifest({
    id: provider.id,
    domain: 'code-check',
    name: {
      zh: provider.rule.designCode || provider.id,
      en: provider.rule.designCode || provider.id,
    },
    description: {
      zh: provider.rule.designCode
        ? `${provider.rule.designCode} 规范校核能力。`
        : `${provider.id} 规范校核能力。`,
      en: provider.rule.designCode
        ? `${provider.rule.designCode} code-check capability.`
        : `${provider.id} code-check capability.`,
    },
    triggers: provider.rule.designCode ? [provider.rule.designCode] : [provider.id],
    stages: ['design'],
    autoLoadByDefault: false,
    requires: [],
    conflicts: [],
    capabilities: ['code-check-policy', 'code-check-execution'],
    enabledTools: ['run_code_check'],
    supportedModelFamilies: [...GENERIC_MODEL_FAMILIES],
    priority: provider.priority,
  }));
}

function buildValidationManifests(): SkillManifest[] {
  return [createGenericDomainManifest({
    id: 'validation-structure-model',
    domain: 'validation',
    name: {
      zh: '结构模型校验',
      en: 'Structure Model Validation',
    },
    description: {
      zh: '对结构模型执行输入与一致性校验。',
      en: 'Validate structural model inputs and consistency.',
    },
    triggers: ['validate', 'validation', '校验'],
    stages: ['draft', 'analysis'],
    autoLoadByDefault: false,
    requires: [],
    conflicts: [],
    capabilities: ['model-validation'],
    enabledTools: ['validate_model'],
    supportedModelFamilies: [...GENERIC_MODEL_FAMILIES],
    priority: 100,
  })];
}

function buildReportExportManifests(): SkillManifest[] {
  return [createGenericDomainManifest({
    id: 'report-export-builtin',
    domain: 'report-export',
    name: {
      zh: '内置报告导出',
      en: 'Builtin Report Export',
    },
    description: {
      zh: '汇总分析与规范校核结果并导出报告。',
      en: 'Assemble analysis and code-check results into exportable reports.',
    },
    triggers: ['report', 'export', '报告'],
    stages: ['design'],
    autoLoadByDefault: false,
    requires: [],
    conflicts: [],
    capabilities: ['report-export'],
    enabledTools: ['generate_report'],
    supportedModelFamilies: [...GENERIC_MODEL_FAMILIES],
    priority: 100,
  })];
}

export function listBuiltinDomainSkillManifests(): SkillManifest[] {
  return [
    ...buildAnalysisManifests(),
    ...buildCodeCheckManifests(),
    ...buildValidationManifests(),
    ...buildReportExportManifests(),
  ];
}
