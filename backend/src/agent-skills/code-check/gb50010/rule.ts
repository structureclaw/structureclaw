import { executeGB50010CodeCheckDomain, matchesGB50010Code } from './entry.js';
import type { CodeCheckRule } from '../rule.js';

export const GB50010CodeCheckRule: CodeCheckRule = {
  skillId: 'code-check-gb50010',
  designCode: 'GB50010',
  matches: matchesGB50010Code,
  execute: executeGB50010CodeCheckDomain,
};
