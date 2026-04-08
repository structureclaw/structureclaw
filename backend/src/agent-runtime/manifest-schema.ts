import { z } from 'zod';
import { ALL_SKILL_DOMAINS } from './types.js';

const localizedTextSchema = z.object({
  zh: z.string().trim().min(1),
  en: z.string().trim().min(1),
});

const skillStageSchema = z.enum(['intent', 'draft', 'analysis', 'design']);
const analysisTypeSchema = z.enum(['static', 'dynamic', 'seismic', 'nonlinear']);
const materialFamilySchema = z.enum(['steel', 'concrete', 'composite', 'timber', 'masonry', 'generic']);
const toolSourceSchema = z.enum(['builtin', 'external']);
const skillSourceSchema = z.enum(['builtin', 'external']);
const toolTierSchema = z.enum(['foundation', 'domain', 'extension']);
const toolCategorySchema = z.enum(['modeling', 'analysis', 'code-check', 'report', 'utility']);

export const skillManifestFileSchema = z.object({
  id: z.string().trim().min(1),
  domain: z.enum(ALL_SKILL_DOMAINS as [string, ...string[]]),
  source: skillSourceSchema.default('builtin'),
  name: localizedTextSchema,
  description: localizedTextSchema,
  triggers: z.array(z.string().trim().min(1)).default([]),
  stages: z.array(skillStageSchema).default([]),
  structureType: z.string().trim().min(1).default('unknown'),
  structuralTypeKeys: z.array(z.string().trim().min(1)).default([]),
  capabilities: z.array(z.string().trim().min(1)).default([]),
  grants: z.array(z.string().trim().min(1)).default([]),
  providesTools: z.array(z.string().trim().min(1)).default([]),
  requires: z.array(z.string().trim().min(1)).default([]),
  conflicts: z.array(z.string().trim().min(1)).default([]),
  autoLoadByDefault: z.boolean().default(false),
  priority: z.number().int().default(0),
  compatibility: z.object({
    minRuntimeVersion: z.string().trim().min(1),
    skillApiVersion: z.string().trim().min(1),
  }),
  software: z.enum(['opensees', 'simplified']).optional(),
  analysisType: analysisTypeSchema.optional(),
  engineId: z.string().trim().min(1).optional(),
  adapterKey: z.string().trim().min(1).optional(),
  runtimeRelativePath: z.string().trim().min(1).optional(),
  schemaVersions: z.array(z.string().trim().min(1)).default([]),
  defaultSchemaVersion: z.string().trim().min(1).optional(),
  designCode: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  scenarioKeys: z.array(z.string().trim().min(1)).default([]),
  loadTypes: z.array(z.string().trim().min(1)).default([]),
  boundaryTypes: z.array(z.string().trim().min(1)).default([]),
  combinationTypes: z.array(z.string().trim().min(1)).default([]),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  supportedAnalysisTypes: z.array(analysisTypeSchema).default([]),
  supportedModelFamilies: z.array(z.string().trim().min(1)).default(['generic']),
  materialFamilies: z.array(materialFamilySchema).default([]),
  toolHints: z.record(z.unknown()).default({}),
  aliases: z.array(z.string().trim().min(1)).default([]),
});

export const toolManifestFileSchema = z.object({
  id: z.string().trim().min(1),
  source: toolSourceSchema.default('builtin'),
  tier: toolTierSchema,
  category: toolCategorySchema,
  enabledByDefault: z.boolean().default(false),
  displayName: localizedTextSchema,
  description: localizedTextSchema,
  requiresSkills: z.array(z.string().trim().min(1)).default([]),
  requiresTools: z.array(z.string().trim().min(1)).default([]),
  tags: z.array(z.string().trim().min(1)).default([]),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  errorCodes: z.array(z.string().trim().min(1)).default([]),
});

export type SkillManifestFile = z.infer<typeof skillManifestFileSchema>;
export type ToolManifestFile = z.infer<typeof toolManifestFileSchema>;

export function formatManifestIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
