import { AgentSkillRuntime } from '../agent-runtime/index.js';
import {
  BUILTIN_VALIDATION_STRUCTURE_MODEL_LEGACY_ALIASES,
  BUILTIN_VALIDATION_STRUCTURE_MODEL_SKILL_ID,
  resolveBuiltinValidationSkillCanonicalId,
} from '../agent-runtime/builtin-domain-manifests.js';
import {
  loadSkillManifestsFromDirectory,
  resolveBuiltinSkillManifestRoot,
  type LoadedSkillManifest,
} from '../agent-runtime/skill-manifest-loader.js';
import type {
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

export type BuiltinSkillCatalogSourceKind =
  | 'file-manifest'
  | 'runtime-manifest';

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

function mergeStringArrays(base: readonly string[], patch: readonly string[] | undefined): string[] {
  if (patch === undefined) {
    return [...base];
  }
  return uniqueStrings([...base, ...patch]);
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

    const fileManifests = await loadSkillManifestsFromDirectory(this.builtinSkillManifestRoot);
    for (const manifest of fileManifests) {
      this.applyPatch(catalog, this.buildFileManifestPatch(manifest));
    }

    const manifests = await this.skillRuntime.listSkillManifests();
    for (const manifest of manifests) {
      this.applyPatch(catalog, this.buildManifestPatch(manifest));
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
