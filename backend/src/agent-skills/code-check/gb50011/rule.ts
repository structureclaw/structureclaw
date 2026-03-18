import { executeGB50011CodeCheckDomain, matchesGB50011Code } from './entry.js';
import type { CodeCheckRule } from '../rule.js';

export const GB50011CodeCheckRule: CodeCheckRule = {
  skillId: 'code-check-gb50011',
  designCode: 'GB50011',
  matches: matchesGB50011Code,
  execute: executeGB50011CodeCheckDomain,
};
