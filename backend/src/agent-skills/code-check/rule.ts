import type { AxiosInstance } from 'axios';
import type { CodeCheckDomainInput } from './types.js';

export interface CodeCheckRule {
  skillId: string;
  designCode?: string;
  matches: (code: string) => boolean;
  execute: (engineClient: AxiosInstance, input: CodeCheckDomainInput, engineId?: string) => Promise<unknown>;
}
