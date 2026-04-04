import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { ALL_SKILL_DOMAINS } from './types.js';
import type { AgentSkillBundle, AgentSkillFile, AgentSkillMetadata, AgentSkillPlugin, SkillDomain, SkillManifest, SkillStage } from './types.js';

interface FrontmatterResult {
  metadata: Record<string, unknown>;
  body: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function collectDirectories(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(current);
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      stack.push(path.join(current, entry.name));
    }
  }
  return result;
}

function hasRequiredExtensionInDescendants(root: string, requiredExtensions: string[]): boolean {
  const directories = collectDirectories(root);
  return directories.some((directory) => requiredExtensions.some((requiredExtension) => existsSync(path.join(directory, requiredExtension))));
}

function resolveSkillRoot(candidates: string[], requiredExtensions?: string[]): string {
  const matched = candidates.find((candidate) => {
    if (!existsSync(candidate)) {
      return false;
    }
    if (!requiredExtensions?.length) {
      return true;
    }
    return hasRequiredExtensionInDescendants(candidate, requiredExtensions);
  });
  if (!matched) {
    throw new Error(`Agent skill directory not found. Tried: ${candidates.join(', ')}`);
  }
  return matched;
}

const MODULE_SKILL_ROOT = resolveSkillRoot([
  path.resolve(process.cwd(), 'backend/dist/agent-skills'),
  path.resolve(process.cwd(), 'dist/agent-skills'),
  path.resolve(process.cwd(), 'backend/src/agent-skills'),
  path.resolve(process.cwd(), 'src/agent-skills'),
  path.resolve(MODULE_DIR, '../../agent-skills'),
  path.resolve(MODULE_DIR, '../../src/agent-skills'),
], ['handler.js', 'handler.ts']);

const MARKDOWN_SKILL_ROOT = resolveSkillRoot([
  path.resolve(process.cwd(), 'backend/src/agent-skills'),
  path.resolve(process.cwd(), 'src/agent-skills'),
  path.resolve(MODULE_DIR, '../../src/agent-skills'),
  path.resolve(MODULE_DIR, '../../agent-skills'),
], ['intent.md']);

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

function normalizeDomain(value: unknown): SkillDomain | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return (ALL_SKILL_DOMAINS as readonly string[]).includes(value)
    ? (value as SkillDomain)
    : undefined;
}

function assertStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function isSkillMarkdownDirectory(skillDir: string): boolean {
  const stageEntries = readdirSync(skillDir, { withFileTypes: true });
  return stageEntries.some((stageEntry) => stageEntry.isFile() && normalizeStage(stageEntry.name.replace(/\.md$/, '')) !== null);
}

function isSkillModuleDirectory(skillDir: string): boolean {
  return (
    existsSync(path.join(skillDir, 'manifest.ts'))
    || existsSync(path.join(skillDir, 'manifest.js'))
  ) && (
    existsSync(path.join(skillDir, 'handler.ts'))
    || existsSync(path.join(skillDir, 'handler.js'))
  );
}

function listTopLevelDirectories(root: string): Set<string> {
  const entries = readdirSync(root, { withFileTypes: true });
  return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

export class AgentSkillLoader {
  private cache: AgentSkillBundle[] | null = null;
  private pluginCache: Promise<AgentSkillPlugin[]> | null = null;

  loadBundles(): AgentSkillBundle[] {
    if (this.cache) {
      return this.cache;
    }

    const entries = collectDirectories(MARKDOWN_SKILL_ROOT);
    const files: AgentSkillFile[] = [];

    for (const skillDir of entries) {
      if (!isSkillMarkdownDirectory(skillDir)) {
        continue;
      }
      const skillStat = statSync(skillDir);
      if (!skillStat.isDirectory()) {
        continue;
      }
      const skillId = path.basename(skillDir);
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
          id: assertString(metadata.id, skillId),
          structureType: assertString(metadata.structureType, skillId) as AgentSkillMetadata['structureType'],
          name: {
            zh: assertString(metadata.zhName, skillId),
            en: assertString(metadata.enName, skillId),
          },
          description: {
            zh: assertString(metadata.zhDescription),
            en: assertString(metadata.enDescription),
          },
          triggers: assertStringArray(metadata.triggers),
          stages: assertStringArray(metadata.stages) as SkillStage[],
          autoLoadByDefault: Boolean(metadata.autoLoadByDefault ?? true),
          domain: normalizeDomain(metadata.domain),
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
        domain: file.domain,
        markdownByStage: {
          [file.stage]: file.markdown,
        },
      });
    }

    this.cache = [...bundlesById.values()].sort((a, b) => a.id.localeCompare(b.id));
    return this.cache;
  }

  async loadPlugins(): Promise<AgentSkillPlugin[]> {
    if (this.pluginCache) {
      return this.pluginCache;
    }

    this.pluginCache = (async () => {
      const bundles = this.loadBundles();
      const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
      const entries = collectDirectories(MODULE_SKILL_ROOT);
      const allowedTopLevelDirectories = listTopLevelDirectories(MARKDOWN_SKILL_ROOT);
      const plugins: AgentSkillPlugin[] = [];

      for (const skillDir of entries) {
        if (!isSkillModuleDirectory(skillDir)) {
          continue;
        }
        const relativePath = path.relative(MODULE_SKILL_ROOT, skillDir);
        const topLevel = relativePath.split(path.sep)[0] || '';
        if (!allowedTopLevelDirectories.has(topLevel)) {
          continue;
        }
        const bundle = bundleById.get(path.basename(skillDir));
        if (!bundle) {
          continue;
        }
        const manifestModule = await this.importSkillModule(skillDir, 'manifest');
        const handlerModule = await this.importSkillModule(skillDir, 'handler');
        const manifest = (manifestModule?.manifest ?? manifestModule?.default) as SkillManifest | undefined;
        const handler = (handlerModule?.handler ?? handlerModule?.default) as AgentSkillPlugin['handler'] | undefined;
        if (!manifest || !handler) {
          continue;
        }
        plugins.push({
          ...bundle,
          ...manifest,
          markdownByStage: bundle.markdownByStage,
          manifest,
          handler,
        });
      }

      return plugins.sort((a, b) => b.manifest.priority - a.manifest.priority || a.id.localeCompare(b.id));
    })();

    return this.pluginCache;
  }

  private async importSkillModule(skillDir: string, baseName: 'manifest' | 'handler'): Promise<Record<string, unknown> | null> {
    const candidates = [
      path.join(skillDir, `${baseName}.js`),
      path.join(skillDir, `${baseName}.ts`),
    ];
    const matched = candidates.find((candidate) => existsSync(candidate));
    if (!matched) {
      return null;
    }
    return import(pathToFileURL(matched).href) as Promise<Record<string, unknown>>;
  }
}
