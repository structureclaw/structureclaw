import { manifest as openseesDynamicSkill } from './opensees-dynamic/manifest.js';
import { manifest as openseesNonlinearSkill } from './opensees-nonlinear/manifest.js';
import { manifest as openseesSeismicSkill } from './opensees-seismic/manifest.js';
import { manifest as openseesStaticSkill } from './opensees-static/manifest.js';
import { manifest as simplifiedDynamicSkill } from './simplified-dynamic/manifest.js';
import { manifest as simplifiedSeismicSkill } from './simplified-seismic/manifest.js';
import { manifest as simplifiedStaticSkill } from './simplified-static/manifest.js';
import type {
  AnalysisEngineDefinition,
  AnalysisExecutionAction,
  AnalysisModelFamily,
  AnalysisRuntimeAdapterKey,
  AnalysisSkillManifest,
  BuiltInAnalysisEngineId,
} from './types.js';

const ANALYSIS_TYPE_ORDER = ['static', 'dynamic', 'seismic', 'nonlinear'] as const;
const MODEL_FAMILY_ORDER = ['frame', 'truss', 'generic'] as const;

function uniqueOrdered<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const seen = new Set(values);
  return order.filter((value) => seen.has(value));
}

function buildEngineDefinition(options: {
  id: BuiltInAnalysisEngineId;
  name: string;
  priority: number;
  routingHints: string[];
  constraints: Record<string, unknown>;
}): AnalysisEngineDefinition {
  const skills = BUILTIN_ANALYSIS_SKILLS.filter((skill) => skill.engineId === options.id);
  if (skills.length === 0) {
    throw new Error(`No builtin analysis skills registered for engine '${options.id}'`);
  }

  const adapterKey = skills[0].adapterKey;
  return {
    id: options.id,
    name: options.name,
    adapterKey,
    capabilities: ['analyze', 'validate', 'code-check'],
    supportedAnalysisTypes: uniqueOrdered(
      skills.map((skill) => skill.analysisType),
      ANALYSIS_TYPE_ORDER,
    ),
    supportedModelFamilies: uniqueOrdered(
      skills.flatMap((skill) => skill.supportedModelFamilies),
      MODEL_FAMILY_ORDER as readonly AnalysisModelFamily[],
    ),
    priority: options.priority,
    routingHints: options.routingHints,
    constraints: options.constraints,
    skillIds: skills.map((skill) => skill.id),
  };
}

export const BUILTIN_ANALYSIS_SKILLS: AnalysisSkillManifest[] = [
  openseesStaticSkill,
  openseesDynamicSkill,
  openseesSeismicSkill,
  openseesNonlinearSkill,
  simplifiedStaticSkill,
  simplifiedDynamicSkill,
  simplifiedSeismicSkill,
].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

export const BUILTIN_ANALYSIS_ENGINES: AnalysisEngineDefinition[] = [
  buildEngineDefinition({
    id: 'builtin-opensees',
    name: 'OpenSees Builtin',
    priority: 100,
    routingHints: ['high-fidelity', 'default'],
    constraints: { requiresOpenSees: true },
  }),
  buildEngineDefinition({
    id: 'builtin-simplified',
    name: 'Simplified Builtin',
    priority: 10,
    routingHints: ['fallback', 'fast'],
    constraints: {},
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

export function listBuiltinAnalysisSkills(): AnalysisSkillManifest[] {
  return [...BUILTIN_ANALYSIS_SKILLS];
}

export function getBuiltinAnalysisSkill(id: string): AnalysisSkillManifest | undefined {
  return BUILTIN_ANALYSIS_SKILLS.find((skill) => skill.id === id);
}

export function listBuiltinAnalysisEngines(): AnalysisEngineDefinition[] {
  return [...BUILTIN_ANALYSIS_ENGINES];
}
