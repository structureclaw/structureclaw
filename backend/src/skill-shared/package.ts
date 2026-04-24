import type {
  AgentAnalysisType,
  MaterialFamily,
  SkillCompatibility,
  SkillDomain,
} from '../agent-runtime/types.js';
import type { SkillProviderSource } from './provider.js';

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
