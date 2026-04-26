import { existsSync } from 'fs';
import path from 'path';
import {
  loadSkillManifestsFromDirectorySync,
  resolveBuiltinSkillManifestRoot,
  type LoadedSkillManifest,
} from '../../agent-runtime/skill-manifest-loader.js';
import type {
  AnalysisEngineDefinition,
  AnalysisExecutionAction,
  AnalysisModelFamily,
  AnalysisSkillManifest,
  BuiltInAnalysisEngineId,
} from './types.js';

const ANALYSIS_TYPE_ORDER = ['static', 'dynamic', 'seismic', 'nonlinear'] as const;
const MODEL_FAMILY_ORDER = ['frame', 'truss', 'generic'] as const;

function assertAnalysisManifestField(
  manifest: LoadedSkillManifest,
  field: 'software' | 'analysisType' | 'engineId' | 'adapterKey',
): string {
  const value = manifest[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Analysis skill manifest ${manifest.manifestPath} is missing required field '${field}'`);
  }
  return value.trim();
}

function toAnalysisSkillManifest(manifest: LoadedSkillManifest): AnalysisSkillManifest {
  const runtimeRelativePath = typeof manifest.runtimeRelativePath === 'string' && manifest.runtimeRelativePath.trim().length > 0
    ? manifest.runtimeRelativePath.trim()
    : 'runtime.py';
  const runtimePath = path.join(path.dirname(manifest.manifestPath), runtimeRelativePath);

  if (!existsSync(runtimePath)) {
    throw new Error(`Analysis skill manifest ${manifest.manifestPath} references missing runtime '${runtimeRelativePath}'`);
  }

  return {
    id: manifest.id,
    domain: 'analysis',
    name: manifest.name,
    description: manifest.description,
    software: assertAnalysisManifestField(manifest, 'software') as AnalysisSkillManifest['software'],
    analysisType: assertAnalysisManifestField(manifest, 'analysisType') as AnalysisSkillManifest['analysisType'],
    engineId: assertAnalysisManifestField(manifest, 'engineId') as AnalysisSkillManifest['engineId'],
    adapterKey: assertAnalysisManifestField(manifest, 'adapterKey') as AnalysisSkillManifest['adapterKey'],
    triggers: Array.isArray(manifest.triggers) ? [...manifest.triggers] : [],
    stages: ['analysis'],
    capabilities: Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0
      ? [...manifest.capabilities]
      : ['analysis-policy', 'analysis-execution'],
    supportedModelFamilies: (
      Array.isArray(manifest.supportedModelFamilies) && manifest.supportedModelFamilies.length > 0
        ? manifest.supportedModelFamilies
        : ['generic']
    ) as AnalysisModelFamily[],
    priority: manifest.priority ?? 0,
    autoLoadByDefault: Boolean(manifest.autoLoadByDefault),
    runtimeRelativePath,
  };
}

function discoverBuiltinAnalysisSkills(): AnalysisSkillManifest[] {
  const manifests = loadSkillManifestsFromDirectorySync(resolveBuiltinSkillManifestRoot());
  return manifests
    .filter((manifest) => manifest.domain === 'analysis')
    .map((manifest) => toAnalysisSkillManifest(manifest))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

function uniqueOrdered<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const seen = new Set(values);
  return order.filter((value) => seen.has(value));
}

function buildEngineDefinition(
  skills: readonly AnalysisSkillManifest[],
  options: {
    id: BuiltInAnalysisEngineId;
    name: string;
    priority: number;
    routingHints: string[];
    constraints: Record<string, unknown>;
  },
): AnalysisEngineDefinition {
  const engineSkills = skills.filter((skill) => skill.engineId === options.id);
  if (engineSkills.length === 0) {
    throw new Error(`No builtin analysis skills registered for engine '${options.id}'`);
  }

  const adapterKey = engineSkills[0].adapterKey;
  return {
    id: options.id,
    name: options.name,
    adapterKey,
    capabilities: ['analyze', 'validate', 'code-check'],
    supportedAnalysisTypes: uniqueOrdered(
      engineSkills.map((skill) => skill.analysisType),
      ANALYSIS_TYPE_ORDER,
    ),
    supportedModelFamilies: uniqueOrdered(
      engineSkills.flatMap((skill) => skill.supportedModelFamilies),
      MODEL_FAMILY_ORDER as readonly AnalysisModelFamily[],
    ),
    priority: options.priority,
    routingHints: options.routingHints,
    constraints: options.constraints,
    skillIds: engineSkills.map((skill) => skill.id),
  };
}

const BUILTIN_ANALYSIS_SKILLS: AnalysisSkillManifest[] = discoverBuiltinAnalysisSkills();

export const BUILTIN_ANALYSIS_ENGINES: AnalysisEngineDefinition[] = [
  buildEngineDefinition(BUILTIN_ANALYSIS_SKILLS, {
    id: 'builtin-opensees',
    name: 'OpenSees Builtin',
    priority: 100,
    routingHints: ['high-fidelity', 'default'],
    constraints: { requiresOpenSees: true },
  }),
  buildEngineDefinition(BUILTIN_ANALYSIS_SKILLS, {
    id: 'builtin-pkpm',
    name: 'PKPM Builtin',
    priority: 90,
    routingHints: ['commercial', 'design-code'],
    constraints: { requiresPKPM: true },
  }),
  buildEngineDefinition(BUILTIN_ANALYSIS_SKILLS, {
    id: 'builtin-yjk',
    name: 'YJK Builtin',
    priority: 85,
    routingHints: ['commercial', 'design-code'],
    constraints: { requiresYJK: true },
  }),
];

export const BUILTIN_ANALYSIS_ENGINE_IDS = BUILTIN_ANALYSIS_ENGINES.map((engine) => engine.id);
export const BUILTIN_ANALYSIS_RUNTIME_ADAPTER_KEYS = BUILTIN_ANALYSIS_ENGINES.map((engine) => engine.adapterKey);

export const LOCAL_GET_ACTION_BY_PATH: Record<string, AnalysisExecutionAction> = {
  '/engines': 'list_engines',
};

export const LOCAL_POST_ACTION_BY_PATH: Record<string, AnalysisExecutionAction> = {
  '/analyze': 'analyze',
};

export function listBuiltinAnalysisEngines(): AnalysisEngineDefinition[] {
  return [...BUILTIN_ANALYSIS_ENGINES];
}
