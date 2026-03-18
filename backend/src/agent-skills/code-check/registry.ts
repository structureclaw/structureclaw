import { CustomCodeCheckRule } from './custom/rule.js';
import { GB50010CodeCheckRule } from './gb50010/rule.js';
import { GB50011CodeCheckRule } from './gb50011/rule.js';
import { GB50017CodeCheckRule } from './gb50017/rule.js';
import { JGJ3CodeCheckRule } from './jgj3/rule.js';
import type { CodeCheckRule } from './rule.js';

const CODE_CHECK_RULES: CodeCheckRule[] = [
  GB50017CodeCheckRule,
  GB50010CodeCheckRule,
  GB50011CodeCheckRule,
  JGJ3CodeCheckRule,
  CustomCodeCheckRule,
];

const CODE_BY_SKILL_ID = CODE_CHECK_RULES.reduce<Record<string, string>>((acc, rule) => {
  if (rule.designCode) {
    acc[rule.skillId] = rule.designCode;
  }
  return acc;
}, {});

const CODE_CHECK_SKILL_PRIORITY = CODE_CHECK_RULES.map((rule) => rule.skillId);

export function resolveCodeCheckRule(code: string): CodeCheckRule {
  return CODE_CHECK_RULES.find((rule) => rule.matches(code)) || CODE_CHECK_RULES[CODE_CHECK_RULES.length - 1];
}

export function resolveCodeCheckDesignCodeFromSkillIds(skillIds: string[] | undefined): string | undefined {
  if (!Array.isArray(skillIds) || skillIds.length === 0) {
    return undefined;
  }

  const selected = new Set(skillIds);
  for (const skillId of CODE_CHECK_SKILL_PRIORITY) {
    if (!selected.has(skillId)) {
      continue;
    }
    const mapped = CODE_BY_SKILL_ID[skillId];
    if (mapped) {
      return mapped;
    }
  }

  return undefined;
}
