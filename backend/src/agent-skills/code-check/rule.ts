import type { BaseSkillProvider } from '../shared/provider.js';
import type { CodeCheckDomainInput } from './types.js';

export interface CodeCheckClient {
  post<T = any>(path: string, payload?: Record<string, unknown>): Promise<{ data: T }>;
}

export interface CodeCheckRule {
  skillId: string;
  designCode?: string;
  matches: (code: string) => boolean;
  execute: (engineClient: CodeCheckClient, input: CodeCheckDomainInput, engineId?: string) => Promise<unknown>;
}

export interface CodeCheckRuleProvider extends BaseSkillProvider<'code-check'> {
  fallback?: boolean;
  rule: CodeCheckRule;
}
