/**
 * Validation Skill Registry
 * 验证技能注册表
 *
 * Manages validation skills and provides validation execution functions.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ValidationExecutionAction, ValidationSkillManifest } from './types.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

interface FrontmatterResult {
  metadata: Record<string, unknown>;
}

/**
 * Resolve validation skill root directory
 */
function resolveValidationSkillRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'backend/src/agent-skills/validation'),
    path.resolve(process.cwd(), 'src/agent-skills/validation'),
    path.resolve(MODULE_DIR, '../../../src/agent-skills/validation'),
    path.resolve(MODULE_DIR, '../../src/agent-skills/validation'),
    path.resolve(MODULE_DIR),
  ];

  // Find directory containing at least one skill subdirectory with intent.md
  const matched = candidates.find((candidate) => {
    if (!existsSync(candidate)) {
      return false;
    }
    try {
      return readdirSync(candidate).some((name) =>
        existsSync(path.join(candidate, name, 'intent.md'))
      );
    } catch {
      return false;
    }
  });
  if (!matched) {
    throw new Error(`Validation skill directory not found. Tried: ${candidates.join(', ')}`);
  }
  return matched;
}

/**
 * Parse scalar value from frontmatter
 */
function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Parse frontmatter from markdown
 */
function parseFrontmatter(markdown: string): FrontmatterResult {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const trimmed = normalized.trimStart();

  // Use regex to robustly extract frontmatter block
  const match = trimmed.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return { metadata: {} };
  }

  const metadata: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    metadata[key] = parseScalar(line.slice(separator + 1));
  }
  return { metadata };
}

/**
 * Type assertion helpers
 */
function assertString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function assertStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : fallback;
}

/**
 * Convert validation skill directory to manifest
 */
function toValidationSkillManifest(skillDir: string): ValidationSkillManifest | null {
  const intentPath = path.join(skillDir, 'intent.md');
  const runtimePath = path.join(skillDir, 'runtime.py');
  if (!existsSync(intentPath) || !existsSync(runtimePath)) {
    return null;
  }

  const { metadata } = parseFrontmatter(readFileSync(intentPath, 'utf-8'));
  const id = assertString(metadata.id, path.basename(skillDir));
  if (!id) {
    return null;
  }

  return {
    id,
    domain: 'validation',
    name: {
      zh: assertString(metadata.zhName, id),
      en: assertString(metadata.enName, id),
    },
    description: {
      zh: assertString(metadata.zhDescription),
      en: assertString(metadata.enDescription),
    },
    triggers: assertStringArray(metadata.triggers),
    stages: ['validation'],
    capabilities: assertStringArray(metadata.capabilities),
    priority: Number(metadata.priority ?? 100),
    autoLoadByDefault: Boolean(metadata.autoLoadByDefault ?? true),
    runtimeRelativePath: assertString(metadata.runtimeRelativePath, 'runtime.py'),
    schemaVersions: assertStringArray(metadata.schemaVersions),
    defaultSchemaVersion: assertString(metadata.defaultSchemaVersion),
  };
}

/**
 * Discover builtin validation skills
 */
function discoverBuiltinValidationSkills(): ValidationSkillManifest[] {
  const root = resolveValidationSkillRoot();
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'runtime')
    .map((entry) => toValidationSkillManifest(path.join(root, entry.name)))
    .filter((skill): skill is ValidationSkillManifest => skill !== null)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

// Export builtin skills
export const BUILTIN_VALIDATION_SKILLS: ValidationSkillManifest[] = discoverBuiltinValidationSkills();

// Export skill lookup
export const VALIDATION_SKILL_BY_ID: Record<string, ValidationSkillManifest> = Object.fromEntries(
  BUILTIN_VALIDATION_SKILLS.map((skill) => [skill.id, skill]),
);

// Export action mappings
export const VALIDATION_GET_ACTION_BY_PATH: Record<string, ValidationExecutionAction> = {
  '/validators': 'list_validators',
};

export const VALIDATION_POST_ACTION_BY_PATH: Record<string, ValidationExecutionAction> = {
  '/validate': 'validate',
};

/**
 * List all builtin validation skills
 */
export function listBuiltinValidationSkills(): ValidationSkillManifest[] {
  return [...BUILTIN_VALIDATION_SKILLS];
}

/**
 * Get a specific validation skill by ID
 */
export function getBuiltinValidationSkill(id: string): ValidationSkillManifest | undefined {
  return VALIDATION_SKILL_BY_ID[id];
}

/**
 * Check if a validation skill exists
 */
export function hasValidationSkill(id: string): boolean {
  return id in VALIDATION_SKILL_BY_ID;
}

/**
 * Find validation skills by trigger keyword
 */
export function findValidationSkillsByTrigger(trigger: string): ValidationSkillManifest[] {
  const lowerTrigger = trigger.toLowerCase();
  return BUILTIN_VALIDATION_SKILLS.filter((skill) =>
    skill.triggers.some((t) => t.toLowerCase().includes(lowerTrigger)),
  );
}

/**
 * Get validation skill capabilities
 */
export function getValidationSkillCapabilities(skillId: string): string[] {
  const skill = getBuiltinValidationSkill(skillId);
  return skill?.capabilities ?? [];
}
