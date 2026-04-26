import path from 'path';
import {
  loadSkillManifestsFromDirectorySync,
  resolveBuiltinSkillManifestRoot,
  type LoadedSkillManifest,
} from '../../agent-runtime/skill-manifest-loader.js';
import type {
  LoadBoundaryScenarioKey,
  LoadBoundarySkillId,
  LoadBoundarySkillManifest,
} from './types.js';

const DEFAULT_MANIFEST_VERSION = '1.0.0';
const LOAD_BOUNDARY_ROOT = path.join(resolveBuiltinSkillManifestRoot(), 'load-boundary');
const VALID_SCENARIO_KEYS = new Set<LoadBoundaryScenarioKey>([
  'beam',
  'truss',
  'portal-frame',
  'double-span-beam',
  'frame',
]);

function cloneArray<T>(values: readonly T[] | undefined): T[] | undefined {
  return Array.isArray(values) ? [...values] : undefined;
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value ? { ...value } : undefined;
}

function normalizeScenarioKeys(skillId: string, values: readonly string[]): LoadBoundaryScenarioKey[] {
  const normalized = values.filter((value): value is LoadBoundaryScenarioKey =>
    VALID_SCENARIO_KEYS.has(value as LoadBoundaryScenarioKey)
  );
  if (normalized.length !== values.length) {
    const invalidKeys = values.filter((value) => !VALID_SCENARIO_KEYS.has(value as LoadBoundaryScenarioKey));
    throw new Error(
      `Invalid load-boundary scenarioKeys in skill.yaml for "${skillId}": ${invalidKeys.join(', ')}`,
    );
  }
  return normalized;
}

function toLoadBoundarySkillManifest(manifest: LoadedSkillManifest): LoadBoundarySkillManifest {
  if (manifest.domain !== 'load-boundary') {
    throw new Error(`Expected load-boundary manifest, received domain "${manifest.domain}" for "${manifest.id}".`);
  }

  return {
    id: manifest.id,
    name: { ...manifest.name },
    description: { ...manifest.description },
    triggers: [...manifest.triggers],
    stages: [...manifest.stages],
    scenarioKeys: normalizeScenarioKeys(manifest.id, manifest.scenarioKeys ?? []),
    domain: 'load-boundary',
    version: manifest.version ?? DEFAULT_MANIFEST_VERSION,
    requires: [...manifest.requires],
    conflicts: [...manifest.conflicts],
    capabilities: [...manifest.capabilities],
    supportedAnalysisTypes: cloneArray(manifest.supportedAnalysisTypes),
    materialFamilies: cloneArray(manifest.materialFamilies),
    priority: manifest.priority,
    compatibility: { ...manifest.compatibility },
    supportedModelFamilies: cloneArray(manifest.supportedModelFamilies),
    loadTypes: cloneArray(manifest.loadTypes),
    boundaryTypes: cloneArray(manifest.boundaryTypes),
    combinationTypes: cloneArray(manifest.combinationTypes),
    inputSchema: cloneRecord(manifest.inputSchema),
    outputSchema: cloneRecord(manifest.outputSchema),
  };
}

export const BUILTIN_LOAD_BOUNDARY_SKILLS: LoadBoundarySkillManifest[] = loadSkillManifestsFromDirectorySync(
  LOAD_BOUNDARY_ROOT,
).map((manifest) => toLoadBoundarySkillManifest(manifest));

export function getBuiltinLoadBoundarySkill(id: LoadBoundarySkillId): LoadBoundarySkillManifest | undefined {
  return BUILTIN_LOAD_BOUNDARY_SKILLS.find((skill) => skill.id === id);
}

export function listBuiltinLoadBoundarySkills(): LoadBoundarySkillManifest[] {
  return [...BUILTIN_LOAD_BOUNDARY_SKILLS];
}

export function listLoadBoundarySkillsByCapability(capability: string): LoadBoundarySkillManifest[] {
  return BUILTIN_LOAD_BOUNDARY_SKILLS.filter((skill) => skill.capabilities.includes(capability));
}
