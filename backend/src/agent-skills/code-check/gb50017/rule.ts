import { executeGB50017CodeCheckDomain, matchesGB50017Code } from './entry.js';
import type { CodeCheckRule } from '../rule.js';

export const GB50017CodeCheckRule: CodeCheckRule = {
  skillId: 'code-check-gb50017',
  designCode: 'GB50017',
  matches: matchesGB50017Code,
  execute: executeGB50017CodeCheckDomain,
};
