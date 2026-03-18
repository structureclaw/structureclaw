import { executeCustomCodeCheckDomain } from './entry.js';
import type { CodeCheckRule } from '../rule.js';

export const CustomCodeCheckRule: CodeCheckRule = {
  skillId: 'code-check-custom',
  matches: () => true,
  execute: executeCustomCodeCheckDomain,
};
