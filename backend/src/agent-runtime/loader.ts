import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { formatManifestIssues, skillManifestFileSchema } from './manifest-schema.js';
import { loadSkillManifestsFromDirectorySync, toRuntimeSkillManifest } from './skill-manifest-loader.js';
import type { AgentSkillBundle, AgentSkillFile, AgentSkillMetadata, AgentSkillPlugin, SkillDomain, SkillStage } from './types.js';

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
], ['skill.yaml']);

function stripLegacyMarkdownHeader(markdown: string): string {
  const normalizedMarkdown = markdown.replace(/\r\n/g, '\n');
  // Stage Markdown is content-only now, but strip any leftover YAML header
  // so legacy local files do not leak obsolete metadata into prompts.
  const trimmed = normalizedMarkdown.trimStart();
  if (!trimmed.startsWith('---\n')) {
    return normalizedMarkdown;
  }

  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return normalizedMarkdown;
  }
  return trimmed.slice(endIndex + 5).trim();
}

function normalizeStage(name: string): SkillStage | null {
  if (name === 'intent' || name === 'draft' || name === 'analysis' || name === 'design') {
    return name;
  }
  return null;
}

function readSkillManifest(skillDir: string): {
  id: string;
  structureType: AgentSkillMetadata['structureType'];
  name: AgentSkillMetadata['name'];
  description: AgentSkillMetadata['description'];
  triggers: string[];
  stages: SkillStage[];
  autoLoadByDefault: boolean;
  domain: SkillDomain;
} {
  const manifestPath = path.join(skillDir, 'skill.yaml');
  const parsed = skillManifestFileSchema.safeParse(parseYaml(readFileSync(manifestPath, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid skill manifest at ${manifestPath}: ${formatManifestIssues(parsed.error)}`);
  }
  return {
    id: parsed.data.id,
    structureType: parsed.data.structureType as AgentSkillMetadata['structureType'],
    name: parsed.data.name,
    description: parsed.data.description,
    triggers: [...parsed.data.triggers],
    stages: [...parsed.data.stages] as SkillStage[],
    autoLoadByDefault: parsed.data.autoLoadByDefault,
    domain: parsed.data.domain as SkillDomain,
  };
}

function isSkillMarkdownDirectory(skillDir: string): boolean {
  if (!existsSync(path.join(skillDir, 'skill.yaml'))) {
    return false;
  }
  const stageEntries = readdirSync(skillDir, { withFileTypes: true });
  return stageEntries.some((stageEntry) => stageEntry.isFile() && normalizeStage(stageEntry.name.replace(/\.md$/, '')) !== null);
}

function isSkillModuleDirectory(skillDir: string): boolean {
  return existsSync(path.join(skillDir, 'handler.ts'))
    || existsSync(path.join(skillDir, 'handler.js'));
}

function listTopLevelDirectories(root: string): Set<string> {
  const entries = readdirSync(root, { withFileTypes: true });
  return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

function normalizeRelativePath(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

export class AgentSkillLoader {
  private cache: AgentSkillBundle[] | null = null;
  private pluginCache: Promise<AgentSkillPlugin[]> | null = null;
  private readonly moduleSkillRoot: string;
  private readonly markdownSkillRoot: string;

  constructor(options?: {
    moduleSkillRoot?: string;
    markdownSkillRoot?: string;
  }) {
    this.moduleSkillRoot = options?.moduleSkillRoot || MODULE_SKILL_ROOT;
    this.markdownSkillRoot = options?.markdownSkillRoot || MARKDOWN_SKILL_ROOT;
  }

  loadBundles(): AgentSkillBundle[] {
    if (this.cache) {
      return this.cache;
    }

    const entries = collectDirectories(this.markdownSkillRoot);
    const files: AgentSkillFile[] = [];

    for (const skillDir of entries) {
      if (!isSkillMarkdownDirectory(skillDir)) {
        continue;
      }
      const skillStat = statSync(skillDir);
      if (!skillStat.isDirectory()) {
        continue;
      }
      const manifest = readSkillManifest(skillDir);
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
        const file: AgentSkillFile = {
          id: manifest.id,
          structureType: manifest.structureType,
          name: manifest.name,
          description: manifest.description,
          triggers: manifest.triggers,
          stages: manifest.stages,
          autoLoadByDefault: manifest.autoLoadByDefault,
          domain: manifest.domain,
          stage,
          markdown: stripLegacyMarkdownHeader(raw),
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
      const manifestByRelativePath = new Map(
        loadSkillManifestsFromDirectorySync(this.markdownSkillRoot).map((manifest) => [
          normalizeRelativePath(this.markdownSkillRoot, path.dirname(manifest.manifestPath)),
          toRuntimeSkillManifest(manifest),
        ]),
      );
      const entries = collectDirectories(this.moduleSkillRoot);
      const allowedTopLevelDirectories = listTopLevelDirectories(this.markdownSkillRoot);
      const plugins: AgentSkillPlugin[] = [];

      for (const skillDir of entries) {
        if (!isSkillModuleDirectory(skillDir)) {
          continue;
        }
        const relativePath = normalizeRelativePath(this.moduleSkillRoot, skillDir);
        const topLevel = relativePath.split('/')[0] || '';
        if (!allowedTopLevelDirectories.has(topLevel)) {
          continue;
        }
        const manifest = manifestByRelativePath.get(relativePath);
        const bundle = manifest ? bundleById.get(manifest.id) : undefined;
        if (!bundle || !manifest) {
          continue;
        }
        const handlerModule = await this.importSkillModule(skillDir, 'handler');
        const handler = (handlerModule?.handler ?? handlerModule?.default) as AgentSkillPlugin['handler'] | undefined;
        if (!handler) {
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

  private async importSkillModule(skillDir: string, baseName: 'handler'): Promise<Record<string, unknown> | null> {
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
