import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type { AgentSkillBundle, AgentSkillFile, AgentSkillMetadata, SkillStage } from './types.js';

interface FrontmatterResult {
  metadata: Record<string, unknown>;
  body: string;
}

const SKILL_ROOT = path.resolve(process.cwd(), 'backend/src/agent-skills');

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

function parseFrontmatter(markdown: string): FrontmatterResult {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith('---\n')) {
    return { metadata: {}, body: markdown };
  }

  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { metadata: {}, body: markdown };
  }

  const header = trimmed.slice(4, endIndex).split('\n');
  const metadata: Record<string, unknown> = {};
  for (const line of header) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1);
    metadata[key] = parseScalar(rawValue);
  }

  return {
    metadata,
    body: trimmed.slice(endIndex + 5).trim(),
  };
}

function normalizeStage(name: string): SkillStage | null {
  if (name === 'intent' || name === 'draft' || name === 'analysis' || name === 'design') {
    return name;
  }
  return null;
}

function assertString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function assertStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export class AgentSkillLoader {
  private cache: AgentSkillBundle[] | null = null;

  loadBundles(): AgentSkillBundle[] {
    if (this.cache) {
      return this.cache;
    }

    const entries = readdirSync(SKILL_ROOT, { withFileTypes: true });
    const files: AgentSkillFile[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillDir = path.join(SKILL_ROOT, entry.name);
      const skillStat = statSync(skillDir);
      if (!skillStat.isDirectory()) {
        continue;
      }
      const stageEntries = readdirSync(skillDir, { withFileTypes: true });
      for (const stageEntry of stageEntries) {
        if (!stageEntry.isFile() || !stageEntry.name.endsWith('.md')) {
          continue;
        }
        const stage = normalizeStage(stageEntry.name.replace(/\.md$/, ''));
        if (!stage) {
          continue;
        }
        const raw = readFileSync(path.join(skillDir, stageEntry.name), 'utf-8');
        const { metadata, body } = parseFrontmatter(raw);
        const file: AgentSkillFile = {
          id: assertString(metadata.id, entry.name),
          structureType: assertString(metadata.structureType, entry.name) as AgentSkillMetadata['structureType'],
          name: {
            zh: assertString(metadata.zhName, entry.name),
            en: assertString(metadata.enName, entry.name),
          },
          description: {
            zh: assertString(metadata.zhDescription),
            en: assertString(metadata.enDescription),
          },
          triggers: assertStringArray(metadata.triggers),
          stages: assertStringArray(metadata.stages) as SkillStage[],
          autoLoadByDefault: Boolean(metadata.autoLoadByDefault ?? true),
          stage,
          markdown: body,
        };
        files.push(file);
      }
    }

    const bundlesById = new Map<string, AgentSkillBundle>();
    for (const file of files) {
      const existing = bundlesById.get(file.id);
      if (existing) {
        existing.markdownByStage[file.stage] = file.markdown;
        existing.stages = Array.from(new Set([...existing.stages, ...file.stages, file.stage])) as SkillStage[];
        continue;
      }
      bundlesById.set(file.id, {
        id: file.id,
        structureType: file.structureType,
        name: file.name,
        description: file.description,
        triggers: file.triggers,
        stages: Array.from(new Set([...file.stages, file.stage])) as SkillStage[],
        autoLoadByDefault: file.autoLoadByDefault,
        markdownByStage: {
          [file.stage]: file.markdown,
        },
      });
    }

    this.cache = [...bundlesById.values()].sort((a, b) => a.id.localeCompare(b.id));
    return this.cache;
  }
}
