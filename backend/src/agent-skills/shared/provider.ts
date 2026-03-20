export type SkillProviderSource = 'builtin' | 'skillhub';

export interface BaseSkillProvider<TDomain extends string> {
  id: string;
  domain: TDomain;
  source: SkillProviderSource;
  priority: number;
}

export interface ManifestBackedSkillProvider<TDomain extends string, TManifest> extends BaseSkillProvider<TDomain> {
  manifest: TManifest;
}
