import { executeJGJ3CodeCheckDomain, matchesJGJ3Code } from './entry.js';
import type { CodeCheckRule } from '../rule.js';

export const JGJ3CodeCheckRule: CodeCheckRule = {
  skillId: 'code-check-jgj3',
  designCode: 'JGJ3',
  matches: matchesJGJ3Code,
  execute: executeJGJ3CodeCheckDomain,
};
