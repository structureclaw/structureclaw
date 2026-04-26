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
} from '../agent-runtime/types.js';

const DEFAULT_COMPATIBILITY: SkillCompatibility = {
  minRuntimeVersion: '0.1.0',
  skillApiVersion: 'v1',
};

export interface BuiltinSkillCatalogEntry {
  id: string;
  canonicalId: string;
  aliases: string[];
  domain: SkillDomain;
  name: { zh?: string; en?: string };
  description: { zh?: string; en?: string };
  stages: string[];
  triggers: string[];
  structureType?: string;
  capabilities: string[];
  supportedAnalysisTypes: string[];
  supportedModelFamilies: string[];
  materialFamilies: string[];
  priority: number;
  compatibility: SkillCompatibility;
  manifestPath: string;
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

export class AgentSkillCatalogService {
  private builtinSkillEntriesPromise: Promise<BuiltinSkillCatalogEntry[]> | null = null;

  constructor(
    private readonly builtinSkillManifestRoot = resolveBuiltinSkillManifestRoot(),
  ) {}

  resolveCanonicalSkillId(id: string): string {
    return resolveCanonicalId(id);
  }

  async listBuiltinSkills(): Promise<BuiltinSkillCatalogEntry[]> {
    if (!this.builtinSkillEntriesPromise) {
      this.builtinSkillEntriesPromise = loadSkillManifestsFromDirectory(this.builtinSkillManifestRoot)
        .then((fileManifests) => fileManifests
          .map((manifest) => this.buildCatalogEntry(manifest))
          .sort((left, right) =>
            left.domain.localeCompare(right.domain)
            || right.priority - left.priority
            || left.id.localeCompare(right.id),
          ));
    }
    return this.builtinSkillEntriesPromise;
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

  private buildCatalogEntry(manifest: LoadedSkillManifest): BuiltinSkillCatalogEntry {
    const canonicalId = resolveCanonicalId(manifest.id);
    return {
      id: canonicalId,
      canonicalId,
      aliases: resolveAliases(manifest.id, Array.isArray(manifest.aliases) ? [...manifest.aliases] : []),
      domain: manifest.domain as SkillDomain,
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
      structureType: manifest.structureType,
      capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : [],
      supportedAnalysisTypes: this.normalizeAnalysisTypes(manifest.supportedAnalysisTypes as AgentAnalysisType[]),
      supportedModelFamilies: uniqueStrings(manifest.supportedModelFamilies ?? []),
      materialFamilies: this.normalizeMaterialFamilies(manifest.materialFamilies as MaterialFamily[]),
      priority: manifest.priority ?? 0,
      compatibility: cloneCompatibility(manifest.compatibility),
      manifestPath: manifest.manifestPath,
    };
  }

  private normalizeAnalysisTypes(value: AgentAnalysisType[] | undefined): string[] {
    return uniqueStrings((value ?? []) as string[]);
  }

  private normalizeMaterialFamilies(value: MaterialFamily[] | undefined): string[] {
    return uniqueStrings((value ?? []) as string[]);
  }
}
