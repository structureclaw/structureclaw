import type {
  AgentAnalysisType,
  MaterialFamily,
  SkillCompatibility,
  SkillDomain,
  SkillManifest,
} from '../runtime/types.js';
import type { SkillProviderSource } from './provider.js';
import type { SkillHubCatalogEntry } from '../../services/agent-skillhub.js';

export const BUILTIN_SKILL_PACKAGE_VERSION = '0.0.0-builtin';

export interface SkillPackageEntrypoints {
  [key: string]: string | undefined;
}

export interface SkillPackageMetadata<TDomain extends string = SkillDomain> {
  id: string;
  domain: TDomain;
  version: string;
  source: SkillProviderSource;
  capabilities: string[];
  compatibility: SkillCompatibility;
  entrypoints: SkillPackageEntrypoints;
  enabledByDefault: boolean;
  priority?: number;
  requires?: string[];
  conflicts?: string[];
  supportedLocales?: string[];
  supportedAnalysisTypes?: AgentAnalysisType[];
  materialFamilies?: MaterialFamily[];
  name?: {
    zh?: string;
    en?: string;
  };
  description?: {
    zh?: string;
    en?: string;
  };
  structureType?: string;
}

export function normalizeBuiltInManifestToSkillPackage(
  manifest: SkillManifest,
  options?: {
    version?: string;
    entrypoints?: SkillPackageEntrypoints;
  },
): SkillPackageMetadata {
  return {
    id: manifest.id,
    domain: manifest.domain,
    version: options?.version ?? BUILTIN_SKILL_PACKAGE_VERSION,
    source: 'builtin',
    capabilities: Array.isArray(manifest.capabilities) ? [...manifest.capabilities] : [],
    compatibility: {
      minRuntimeVersion: manifest.compatibility?.minRuntimeVersion || '0.1.0',
      skillApiVersion: manifest.compatibility?.skillApiVersion || 'v1',
    },
    entrypoints: options?.entrypoints ?? {
      manifest: 'manifest',
      handler: 'handler',
    },
    enabledByDefault: Boolean(manifest.autoLoadByDefault),
    priority: manifest.priority,
    requires: Array.isArray(manifest.requires) ? [...manifest.requires] : [],
    conflicts: Array.isArray(manifest.conflicts) ? [...manifest.conflicts] : [],
    supportedLocales: ['zh', 'en'],
    supportedAnalysisTypes: Array.isArray(manifest.supportedAnalysisTypes) ? [...manifest.supportedAnalysisTypes] : [],
    materialFamilies: Array.isArray(manifest.materialFamilies) ? [...manifest.materialFamilies] : [],
    name: {
      zh: manifest.name?.zh,
      en: manifest.name?.en,
    },
    description: {
      zh: manifest.description?.zh,
      en: manifest.description?.en,
    },
    structureType: manifest.structureType,
  };
}

export function normalizeSkillHubCatalogEntryToSkillPackage(
  entry: SkillHubCatalogEntry,
  options?: {
    entrypoints?: SkillPackageEntrypoints;
    enabledByDefault?: boolean;
  },
): SkillPackageMetadata {
  return {
    id: entry.id,
    domain: entry.domain,
    version: entry.version,
    source: 'skillhub',
    capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : [],
    compatibility: {
      minRuntimeVersion: entry.compatibility?.minRuntimeVersion || '0.1.0',
      skillApiVersion: entry.compatibility?.skillApiVersion || 'v1',
    },
    entrypoints: options?.entrypoints ?? entry.entrypoints ?? {},
    enabledByDefault: Boolean(options?.enabledByDefault ?? false),
    supportedLocales: ['zh', 'en'],
    name: {
      zh: entry.name?.zh,
      en: entry.name?.en,
    },
    description: {
      zh: entry.description?.zh,
      en: entry.description?.en,
    },
  };
}
