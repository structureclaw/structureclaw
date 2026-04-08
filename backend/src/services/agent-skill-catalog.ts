import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentSkillRuntime } from '../agent-runtime/index.js';
import {
  BUILTIN_VALIDATION_STRUCTURE_MODEL_LEGACY_ALIASES,
  BUILTIN_VALIDATION_STRUCTURE_MODEL_SKILL_ID,
  resolveBuiltinValidationSkillCanonicalId,
} from '../agent-runtime/builtin-domain-manifests.js';
import { loadSkillManifestsFromDirectory, type LoadedSkillManifest } from '../agent-runtime/skill-manifest-loader.js';
import { listBuiltinAnalysisSkills } from '../agent-skills/analysis/entry.js';
import { listCodeCheckRuleProviders } from '../agent-skills/code-check/entry.js';
import { listBuiltinLoadBoundarySkills } from '../agent-skills/load-boundary/entry.js';
import { listBuiltinValidationSkills } from '../agent-skills/validation/entry.js';
import type {
  AgentSkillBundle,
  AgentAnalysisType,
  MaterialFamily,
  SkillCompatibility,
  SkillDomain,
  SkillManifest,
} from '../agent-runtime/types.js';

const DEFAULT_COMPATIBILITY: SkillCompatibility = {
  minRuntimeVersion: '0.1.0',
  skillApiVersion: 'v1',
};
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export type BuiltinSkillCatalogSourceKind =
  | 'markdown'
  | 'file-manifest'
  | 'runtime-manifest'
  | 'analysis-registry'
  | 'code-check-registry'
  | 'load-boundary-registry'
  | 'validation-registry';

export interface BuiltinSkillCatalogEntry {
  id: string;
  canonicalId: string;
  aliases: string[];
  domain: SkillDomain;
  name: { zh?: string; en?: string };
  description: { zh?: string; en?: string };
  stages: string[];
  triggers: string[];
  autoLoadByDefault: boolean;
  structureType?: string;
  capabilities: string[];
  enabledTools: string[];
  providedTools: string[];
  supportedAnalysisTypes: string[];
  supportedModelFamilies: string[];
  materialFamilies: string[];
  priority: number;
  compatibility: SkillCompatibility;
  sourceKinds: BuiltinSkillCatalogSourceKind[];
}

interface CatalogMergePatch extends Partial<Omit<BuiltinSkillCatalogEntry, 'id' | 'canonicalId' | 'sourceKinds'>> {
  id: string;
  canonicalId?: string;
  sourceKind: BuiltinSkillCatalogSourceKind;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0)));
}

function cloneCompatibility(value: SkillCompatibility | undefined): SkillCompatibility {
  return {
    minRuntimeVersion: value?.minRuntimeVersion || DEFAULT_COMPATIBILITY.minRuntimeVersion,
    skillApiVersion: value?.skillApiVersion || DEFAULT_COMPATIBILITY.skillApiVersion,
  };
}

function resolveCanonicalId(skillId: string): string {
  return resolveBuiltinValidationSkillCanonicalId(skillId);
}

function resolveAliases(skillId: string, aliases?: string[]): string[] {
  const canonicalId = resolveCanonicalId(skillId);
  return uniqueStrings([
    ...(canonicalId === BUILTIN_VALIDATION_STRUCTURE_MODEL_SKILL_ID
      ? [...BUILTIN_VALIDATION_STRUCTURE_MODEL_LEGACY_ALIASES]
      : []),
    ...(canonicalId !== skillId ? [skillId] : []),
    ...(aliases ?? []),
  ]).filter((alias) => alias !== canonicalId);
}

function normalizeBundleStructureType(bundle: AgentSkillBundle): string | undefined {
  if (typeof bundle.structureType !== 'string' || bundle.structureType.trim().length === 0) {
    return undefined;
  }
  if (bundle.structureType === bundle.id && bundle.domain !== 'structure-type') {
    return undefined;
  }
  return bundle.structureType;
}

function mergeStringArrays(base: readonly string[], patch: readonly string[] | undefined): string[] {
  if (patch === undefined) {
    return [...base];
  }
  return uniqueStrings([...base, ...patch]);
}

function collectDirectories(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }
  const result: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(current);
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
  return result;
}

function hasSkillManifestInDescendants(rootDir: string): boolean {
  return collectDirectories(rootDir).some((directory) => existsSync(path.join(directory, 'skill.yaml')));
}

function resolveBuiltinSkillManifestRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'backend/dist/agent-skills'),
    path.resolve(process.cwd(), 'dist/agent-skills'),
    path.resolve(process.cwd(), 'backend/src/agent-skills'),
    path.resolve(process.cwd(), 'src/agent-skills'),
    path.resolve(MODULE_DIR, '../../agent-skills'),
    path.resolve(MODULE_DIR, '../../src/agent-skills'),
  ];
  return candidates.find((candidate) => hasSkillManifestInDescendants(candidate)) || null;
}

export class AgentSkillCatalogService {
  constructor(
    private readonly skillRuntime = new AgentSkillRuntime(),
    private readonly builtinSkillManifestRoot = resolveBuiltinSkillManifestRoot(),
  ) {}

  resolveCanonicalSkillId(id: string): string {
    return resolveCanonicalId(id);
  }

  async listBuiltinSkills(): Promise<BuiltinSkillCatalogEntry[]> {
    const catalog = new Map<string, BuiltinSkillCatalogEntry>();

    for (const bundle of this.skillRuntime.listSkills()) {
      this.applyPatch(catalog, {
        id: bundle.id,
        sourceKind: 'markdown',
        domain: bundle.domain ?? 'general',
        name: {
          zh: bundle.name?.zh,
          en: bundle.name?.en,
        },
        description: {
          zh: bundle.description?.zh,
          en: bundle.description?.en,
        },
        stages: Array.isArray(bundle.stages) ? [...bundle.stages] : [],
        triggers: Array.isArray(bundle.triggers) ? [...bundle.triggers] : [],
        autoLoadByDefault: Boolean(bundle.autoLoadByDefault),
        structureType: normalizeBundleStructureType(bundle),
        capabilities: [],
        enabledTools: [],
        providedTools: [],
        supportedAnalysisTypes: [],
        supportedModelFamilies: [],
        materialFamilies: [],
        priority: 0,
        compatibility: cloneCompatibility(undefined),
      });
    }

    for (const skill of listBuiltinAnalysisSkills()) {
      this.applyPatch(catalog, {
        id: skill.id,
        sourceKind: 'analysis-registry',
        domain: skill.domain,
        name: {
          zh: skill.name.zh,
          en: skill.name.en,
        },
        description: {
          zh: skill.description.zh,
          en: skill.description.en,
        },
        stages: [...skill.stages],
        triggers: [...skill.triggers],
        autoLoadByDefault: skill.autoLoadByDefault,
        capabilities: [...skill.capabilities],
        enabledTools: ['run_analysis'],
        providedTools: [],
        supportedAnalysisTypes: [skill.analysisType],
        supportedModelFamilies: [...skill.supportedModelFamilies],
        materialFamilies: [],
        priority: skill.priority,
        compatibility: cloneCompatibility(undefined),
      });
    }

    for (const provider of listCodeCheckRuleProviders()) {
      this.applyPatch(catalog, {
        id: provider.id,
        sourceKind: 'code-check-registry',
        domain: provider.domain,
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
        stages: ['design'],
        triggers: provider.rule.designCode ? [provider.rule.designCode] : [provider.id],
        autoLoadByDefault: false,
        capabilities: ['code-check-policy', 'code-check-execution'],
        enabledTools: ['run_code_check'],
        providedTools: [],
        supportedAnalysisTypes: [],
        supportedModelFamilies: ['generic'],
        materialFamilies: [],
        priority: provider.priority,
        compatibility: cloneCompatibility(undefined),
      });
    }

    for (const skill of listBuiltinLoadBoundarySkills()) {
      this.applyPatch(catalog, {
        id: skill.id,
        sourceKind: 'load-boundary-registry',
        domain: skill.domain,
        name: {
          zh: skill.name.zh,
          en: skill.name.en,
        },
        description: {
          zh: skill.description.zh,
          en: skill.description.en,
        },
        stages: [...skill.stages],
        triggers: [...skill.triggers],
        autoLoadByDefault: skill.autoLoadByDefault,
        capabilities: [...skill.capabilities],
        enabledTools: [],
        providedTools: [],
        supportedAnalysisTypes: this.normalizeAnalysisTypes(skill.supportedAnalysisTypes),
        supportedModelFamilies: uniqueStrings(skill.supportedModelFamilies ?? []),
        materialFamilies: this.normalizeMaterialFamilies(skill.materialFamilies),
        priority: skill.priority,
        compatibility: cloneCompatibility(skill.compatibility),
      });
    }

    for (const skill of listBuiltinValidationSkills()) {
      this.applyPatch(catalog, {
        id: skill.id,
        sourceKind: 'validation-registry',
        domain: skill.domain,
        name: {
          zh: skill.name.zh,
          en: skill.name.en,
        },
        description: {
          zh: skill.description.zh,
          en: skill.description.en,
        },
        stages: [...skill.stages],
        triggers: [...skill.triggers],
        autoLoadByDefault: skill.autoLoadByDefault,
        capabilities: [...skill.capabilities],
        enabledTools: ['validate_model'],
        providedTools: [],
        supportedAnalysisTypes: [],
        supportedModelFamilies: [],
        materialFamilies: [],
        priority: skill.priority,
        compatibility: cloneCompatibility(undefined),
      });
    }

    const manifests = await this.skillRuntime.listSkillManifests();
    for (const manifest of manifests) {
      this.applyPatch(catalog, this.buildManifestPatch(manifest));
    }

    if (this.builtinSkillManifestRoot) {
      const fileManifests = await loadSkillManifestsFromDirectory(this.builtinSkillManifestRoot);
      for (const manifest of fileManifests) {
        this.applyPatch(catalog, this.buildFileManifestPatch(manifest));
      }
    }

    return [...catalog.values()].sort((left, right) =>
      left.domain.localeCompare(right.domain)
      || right.priority - left.priority
      || left.id.localeCompare(right.id),
    );
  }

  async listSkillIdsByAlias(): Promise<Record<string, string>> {
    const entries = await this.listBuiltinSkills();
    return entries.reduce<Record<string, string>>((acc, entry) => {
      for (const alias of entry.aliases) {
        acc[alias] = entry.canonicalId;
      }
      return acc;
    }, {});
  }

  async getBuiltinSkillById(id: string): Promise<BuiltinSkillCatalogEntry | undefined> {
    const canonicalId = this.resolveCanonicalSkillId(id);
    const entries = await this.listBuiltinSkills();
    return entries.find((entry) => entry.canonicalId === canonicalId);
  }

  private buildManifestPatch(manifest: SkillManifest): CatalogMergePatch {
    return {
      id: manifest.id,
      sourceKind: 'runtime-manifest',
      domain: manifest.domain,
      name: {
        zh: manifest.name?.zh,
        en: manifest.name?.en,
      },
      description: {
        zh: manifest.description?.zh,
        en: manifest.description?.en,
      },
      stages: Array.isArray(manifest.stages) ? [...manifest.stages] : [],
      triggers: Array.isArray(manifest.triggers) ? [...manifest.triggers] : [],
      autoLoadByDefault: Boolean(manifest.autoLoadByDefault),
      structureType: manifest.structureType,
      capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : [],
      enabledTools: Array.isArray(manifest.enabledTools) ? [...manifest.enabledTools] : [],
      providedTools: Array.isArray(manifest.providedTools) ? [...manifest.providedTools] : [],
      supportedAnalysisTypes: this.normalizeAnalysisTypes(manifest.supportedAnalysisTypes),
      supportedModelFamilies: uniqueStrings(manifest.supportedModelFamilies ?? []),
      materialFamilies: this.normalizeMaterialFamilies(manifest.materialFamilies),
      priority: manifest.priority ?? 0,
      compatibility: cloneCompatibility(manifest.compatibility),
    };
  }

  private buildFileManifestPatch(manifest: LoadedSkillManifest): CatalogMergePatch {
    return {
      id: manifest.id,
      sourceKind: 'file-manifest',
      domain: manifest.domain as SkillDomain,
      aliases: Array.isArray(manifest.aliases) ? [...manifest.aliases] : [],
      name: {
        zh: manifest.name?.zh,
        en: manifest.name?.en,
      },
      description: {
        zh: manifest.description?.zh,
        en: manifest.description?.en,
      },
      stages: Array.isArray(manifest.stages) ? [...manifest.stages] : [],
      triggers: Array.isArray(manifest.triggers) ? [...manifest.triggers] : [],
      autoLoadByDefault: Boolean(manifest.autoLoadByDefault),
      structureType: manifest.structureType,
      capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : [],
      enabledTools: Array.isArray(manifest.grants) ? [...manifest.grants] : [],
      providedTools: Array.isArray(manifest.providesTools) ? [...manifest.providesTools] : [],
      supportedAnalysisTypes: this.normalizeAnalysisTypes(manifest.supportedAnalysisTypes as AgentAnalysisType[]),
      supportedModelFamilies: uniqueStrings(manifest.supportedModelFamilies ?? []),
      materialFamilies: this.normalizeMaterialFamilies(manifest.materialFamilies as MaterialFamily[]),
      priority: manifest.priority ?? 0,
      compatibility: cloneCompatibility(manifest.compatibility),
    };
  }

  private applyPatch(catalog: Map<string, BuiltinSkillCatalogEntry>, patch: CatalogMergePatch): void {
    const canonicalId = patch.canonicalId ?? resolveCanonicalId(patch.id);
    const current = catalog.get(canonicalId);
    const merged = this.mergeEntry(current, {
      ...patch,
      canonicalId,
      aliases: resolveAliases(patch.id, patch.aliases),
    });
    catalog.set(canonicalId, merged);
  }

  private createEmptyEntry(id: string, canonicalId: string): BuiltinSkillCatalogEntry {
    return {
      id: canonicalId,
      canonicalId,
      aliases: resolveAliases(id),
      domain: 'general',
      name: {},
      description: {},
      stages: [],
      triggers: [],
      autoLoadByDefault: false,
      structureType: undefined,
      capabilities: [],
      enabledTools: [],
      providedTools: [],
      supportedAnalysisTypes: [],
      supportedModelFamilies: [],
      materialFamilies: [],
      priority: 0,
      compatibility: cloneCompatibility(undefined),
      sourceKinds: [],
    };
  }

  private mergeEntry(
    current: BuiltinSkillCatalogEntry | undefined,
    patch: CatalogMergePatch & { canonicalId: string; aliases?: string[] },
  ): BuiltinSkillCatalogEntry {
    const base = current ?? this.createEmptyEntry(patch.id, patch.canonicalId);
    const runtimeManifestPatch = patch.sourceKind === 'runtime-manifest';
    return {
      ...base,
      id: patch.canonicalId,
      canonicalId: patch.canonicalId,
      aliases: uniqueStrings([...base.aliases, ...(patch.aliases ?? [])]).filter((alias) => alias !== patch.canonicalId),
      domain: patch.domain ?? base.domain,
      name: {
        ...base.name,
        ...(patch.name ?? {}),
      },
      description: {
        ...base.description,
        ...(patch.description ?? {}),
      },
      stages: runtimeManifestPatch
        ? mergeStringArrays(base.stages, patch.stages)
        : (patch.stages !== undefined ? [...patch.stages] : base.stages),
      triggers: runtimeManifestPatch
        ? mergeStringArrays(base.triggers, patch.triggers)
        : (patch.triggers !== undefined ? [...patch.triggers] : base.triggers),
      autoLoadByDefault: runtimeManifestPatch
        ? (base.autoLoadByDefault || Boolean(patch.autoLoadByDefault))
        : (patch.autoLoadByDefault ?? base.autoLoadByDefault),
      structureType: patch.structureType ?? base.structureType,
      capabilities: runtimeManifestPatch
        ? mergeStringArrays(base.capabilities, patch.capabilities)
        : (patch.capabilities !== undefined ? [...patch.capabilities] : base.capabilities),
      enabledTools: runtimeManifestPatch
        ? mergeStringArrays(base.enabledTools, patch.enabledTools)
        : (patch.enabledTools !== undefined ? [...patch.enabledTools] : base.enabledTools),
      providedTools: runtimeManifestPatch
        ? mergeStringArrays(base.providedTools, patch.providedTools)
        : (patch.providedTools !== undefined ? [...patch.providedTools] : base.providedTools),
      supportedAnalysisTypes: runtimeManifestPatch
        ? mergeStringArrays(base.supportedAnalysisTypes, patch.supportedAnalysisTypes)
        : (patch.supportedAnalysisTypes !== undefined
          ? [...patch.supportedAnalysisTypes]
          : base.supportedAnalysisTypes),
      supportedModelFamilies: runtimeManifestPatch
        ? mergeStringArrays(base.supportedModelFamilies, patch.supportedModelFamilies)
        : (patch.supportedModelFamilies !== undefined
          ? [...patch.supportedModelFamilies]
          : base.supportedModelFamilies),
      materialFamilies: runtimeManifestPatch
        ? mergeStringArrays(base.materialFamilies, patch.materialFamilies)
        : (patch.materialFamilies !== undefined ? [...patch.materialFamilies] : base.materialFamilies),
      priority: patch.priority ?? base.priority,
      compatibility: patch.compatibility ? cloneCompatibility(patch.compatibility) : base.compatibility,
      sourceKinds: uniqueStrings([...base.sourceKinds, patch.sourceKind]) as BuiltinSkillCatalogSourceKind[],
    };
  }

  private normalizeAnalysisTypes(value: AgentAnalysisType[] | undefined): string[] {
    return uniqueStrings((value ?? []) as string[]);
  }

  private normalizeMaterialFamilies(value: MaterialFamily[] | undefined): string[] {
    return uniqueStrings((value ?? []) as string[]);
  }
}
