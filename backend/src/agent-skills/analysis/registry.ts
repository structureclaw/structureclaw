import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AnalysisEngineDefinition,
  AnalysisExecutionAction,
  AnalysisModelFamily,
  AnalysisSkillManifest,
  BuiltInAnalysisEngineId,
} from './types.js';

const ANALYSIS_TYPE_ORDER = ['static', 'dynamic', 'seismic', 'nonlinear'] as const;
const MODEL_FAMILY_ORDER = ['frame', 'truss', 'generic'] as const;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

interface FrontmatterResult {
  metadata: Record<string, unknown>;
}

function resolveAnalysisSkillRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'backend/src/agent-skills/analysis'),
    path.resolve(process.cwd(), 'src/agent-skills/analysis'),
    path.resolve(MODULE_DIR, '../../../src/agent-skills/analysis'),
    path.resolve(MODULE_DIR, '../../src/agent-skills/analysis'),
    path.resolve(MODULE_DIR),
  ];

  const matched = candidates.find((candidate) => existsSync(path.join(candidate, 'README.md')));
  if (!matched) {
    throw new Error(`Analysis skill directory not found. Tried: ${candidates.join(', ')}`);
  }
  return matched;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseFrontmatter(markdown: string): FrontmatterResult {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const trimmed = normalized.trimStart();
  if (!trimmed.startsWith('---\n')) {
    return { metadata: {} };
  }

  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { metadata: {} };
  }

  const metadata: Record<string, unknown> = {};
  for (const line of trimmed.slice(4, endIndex).split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    metadata[key] = parseScalar(line.slice(separator + 1));
  }
  return { metadata };
}

function assertString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function assertStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : fallback;
}

function toAnalysisSkillManifest(skillDir: string): AnalysisSkillManifest | null {
  const intentPath = path.join(skillDir, 'intent.md');
  const runtimePath = path.join(skillDir, 'runtime.py');
  if (!existsSync(intentPath) || !existsSync(runtimePath)) {
    return null;
  }

  const { metadata } = parseFrontmatter(readFileSync(intentPath, 'utf-8'));
  const id = assertString(metadata.id, path.basename(skillDir));
  const software = assertString(metadata.software) as AnalysisSkillManifest['software'];
  const analysisType = assertString(metadata.analysisType) as AnalysisSkillManifest['analysisType'];
  const engineId = assertString(metadata.engineId) as AnalysisSkillManifest['engineId'];
  const adapterKey = assertString(metadata.adapterKey) as AnalysisSkillManifest['adapterKey'];

  if (!id || !software || !analysisType || !engineId || !adapterKey) {
    return null;
  }

  return {
    id,
    domain: 'analysis-strategy',
    name: {
      zh: assertString(metadata.zhName, id),
      en: assertString(metadata.enName, id),
    },
    description: {
      zh: assertString(metadata.zhDescription),
      en: assertString(metadata.enDescription),
    },
    software,
    analysisType,
    engineId,
    adapterKey,
    triggers: assertStringArray(metadata.triggers),
    stages: ['analysis'],
    capabilities: assertStringArray(metadata.capabilities, ['analysis-policy', 'analysis-execution']),
    supportedModelFamilies: assertStringArray(metadata.supportedModelFamilies, ['frame', 'truss', 'generic']) as AnalysisModelFamily[],
    priority: Number(metadata.priority ?? 0),
    autoLoadByDefault: Boolean(metadata.autoLoadByDefault ?? true),
    runtimeRelativePath: assertString(metadata.runtimeRelativePath, 'runtime.py'),
  };
}

function discoverBuiltinAnalysisSkills(): AnalysisSkillManifest[] {
  const root = resolveAnalysisSkillRoot();
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'runtime')
    .map((entry) => toAnalysisSkillManifest(path.join(root, entry.name)))
    .filter((skill): skill is AnalysisSkillManifest => skill !== null)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

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

export const BUILTIN_ANALYSIS_SKILLS: AnalysisSkillManifest[] = discoverBuiltinAnalysisSkills();

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
