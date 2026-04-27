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
  // Installed-package layout: dist/backend/ holds compiled JS next to dist/frontend/
  path.resolve(process.cwd(), 'dist/backend/agent-skills'),
  path.resolve(process.cwd(), 'backend/dist/agent-skills'),
  path.resolve(process.cwd(), 'dist/agent-skills'),
  // Source layouts (dev mode)
  path.resolve(process.cwd(), 'src/agent-skills'),
  // MODULE_DIR-relative: works regardless of cwd
  path.resolve(MODULE_DIR, '../../agent-skills'),
  path.resolve(MODULE_DIR, '../../src/agent-skills'),
], ['handler.js', 'handler.ts']);

const MARKDOWN_SKILL_ROOT = resolveSkillRoot([
  // Source layouts: skill.yaml + stage .md live in src/ (not compiled)
  path.resolve(process.cwd(), 'backend/src/agent-skills'),
  path.resolve(process.cwd(), 'src/agent-skills'),
  // MODULE_DIR-relative
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

/**
 * Load stage markdown files from a skill directory into the bundles map.
 * Returns the number of bundles added.
 */
function loadBundlesFromRoot(
  root: string,
  bundlesById: Map<string, AgentSkillBundle>,
  options?: { skipExisting?: boolean },
): number {
  if (!existsSync(root)) return 0;

  const entries = collectDirectories(root);
  let added = 0;

  for (const skillDir of entries) {
    if (!isSkillMarkdownDirectory(skillDir)) continue;
    const skillStat = statSync(skillDir);
    if (!skillStat.isDirectory()) continue;

    let manifest: ReturnType<typeof readSkillManifest>;
    try {
      manifest = readSkillManifest(skillDir);
    } catch (err) {
      console.warn(`[skill-loader] Skipping invalid workspace skill at ${skillDir}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    if (options?.skipExisting && bundlesById.has(manifest.id)) continue;

    const stageEntries = readdirSync(skillDir, { withFileTypes: true });
    for (const stageEntry of stageEntries) {
      if (!stageEntry.isFile() || !stageEntry.name.endsWith('.md')) continue;
      const stage = normalizeStage(stageEntry.name.replace(/\.md$/, ''));
      if (!stage) continue;

      const raw = readFileSync(path.join(skillDir, stageEntry.name), 'utf-8');
      const file: AgentSkillFile = {
        id: manifest.id,
        structureType: manifest.structureType,
        name: manifest.name,
        description: manifest.description,
        triggers: manifest.triggers,
        stages: manifest.stages,
        domain: manifest.domain,
        stage,
        markdown: stripLegacyMarkdownHeader(raw),
      };

      const existing = bundlesById.get(file.id);
      if (existing) {
        existing.markdownByStage[file.stage] = file.markdown;
        existing.stages = Array.from(new Set([...existing.stages, ...file.stages, file.stage])) as SkillStage[];
      } else {
        bundlesById.set(file.id, {
          id: file.id,
          structureType: file.structureType,
          name: file.name,
          description: file.description,
          triggers: file.triggers,
          stages: Array.from(new Set([...file.stages, file.stage])) as SkillStage[],
          domain: file.domain,
          markdownByStage: { [file.stage]: file.markdown },
        });
        added += 1;
      }
    }
  }

  return added;
}

export class AgentSkillLoader {
  private cache: AgentSkillBundle[] | null = null;
  private pluginCache: Promise<AgentSkillPlugin[]> | null = null;
  private readonly moduleSkillRoot: string;
  private readonly markdownSkillRoot: string;
  private readonly workspaceSkillRoot: string | undefined;

  constructor(options?: {
    moduleSkillRoot?: string;
    markdownSkillRoot?: string;
    workspaceSkillRoot?: string;
  }) {
    this.moduleSkillRoot = options?.moduleSkillRoot || MODULE_SKILL_ROOT;
    this.markdownSkillRoot = options?.markdownSkillRoot || MARKDOWN_SKILL_ROOT;
    this.workspaceSkillRoot = options?.workspaceSkillRoot;
  }

  /** Invalidate cached bundles and plugins so the next load re-scans disk. */
  invalidateCache(): void {
    this.cache = null;
    this.pluginCache = null;
  }

  loadBundles(): AgentSkillBundle[] {
    if (this.cache) {
      return this.cache;
    }

    const bundlesById = new Map<string, AgentSkillBundle>();

    // Load builtin bundles first (highest priority)
    loadBundlesFromRoot(this.markdownSkillRoot, bundlesById);

    // Load workspace bundles (builtin wins on id collision)
    if (this.workspaceSkillRoot) {
      loadBundlesFromRoot(this.workspaceSkillRoot, bundlesById, { skipExisting: true });
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

      // --- Builtin plugins ---
      const builtinManifests = loadSkillManifestsFromDirectorySync(this.markdownSkillRoot).map((manifest) => [
        normalizeRelativePath(this.markdownSkillRoot, path.dirname(manifest.manifestPath)),
        toRuntimeSkillManifest(manifest),
      ] as const);
      const manifestByRelativePath = new Map(builtinManifests);

      const entries = collectDirectories(this.moduleSkillRoot);
      const allowedTopLevelDirectories = listTopLevelDirectories(this.markdownSkillRoot);
      const plugins: AgentSkillPlugin[] = [];

      for (const skillDir of entries) {
        if (!isSkillModuleDirectory(skillDir)) continue;
        const relativePath = normalizeRelativePath(this.moduleSkillRoot, skillDir);
        const topLevel = relativePath.split('/')[0] || '';
        if (!allowedTopLevelDirectories.has(topLevel)) continue;
        const manifest = manifestByRelativePath.get(relativePath);
        const bundle = manifest ? bundleById.get(manifest.id) : undefined;
        if (!bundle || !manifest) continue;
        const handlerModule = await this.importSkillModule(skillDir, 'handler');
        const handler = (handlerModule?.handler ?? handlerModule?.default) as AgentSkillPlugin['handler'] | undefined;
        if (!handler) continue;
        plugins.push({
          ...bundle,
          ...manifest,
          markdownByStage: bundle.markdownByStage,
          manifest,
          handler,
        });
      }

      // --- Workspace plugins ---
      if (this.workspaceSkillRoot && existsSync(this.workspaceSkillRoot)) {
        const builtinIds = new Set(plugins.map((p) => p.id));
        const wsEntries = collectDirectories(this.workspaceSkillRoot);

        for (const skillDir of wsEntries) {
          if (!isSkillModuleDirectory(skillDir)) continue;
          let manifest: ReturnType<typeof readSkillManifest>;
          try {
            manifest = readSkillManifest(skillDir);
          } catch {
            continue;
          }
          if (builtinIds.has(manifest.id)) continue; // builtin wins

          const bundle = bundleById.get(manifest.id);
          if (!bundle) continue; // must have markdown bundle

          const handlerModule = await this.importSkillModule(skillDir, 'handler');
          const handler = (handlerModule?.handler ?? handlerModule?.default) as AgentSkillPlugin['handler'] | undefined;
          if (!handler) continue;

          const runtimeManifest: import('./types.js').SkillManifest = {
            id: manifest.id,
            structureType: manifest.structureType,
            name: manifest.name,
            description: manifest.description,
            triggers: manifest.triggers,
            stages: manifest.stages,
            domain: manifest.domain,
            structuralTypeKeys: [],
            requires: [],
            conflicts: [],
            capabilities: [],
            priority: manifest.stages?.length ?? 0,
            compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
          };
          plugins.push({
            ...bundle,
            ...runtimeManifest,
            markdownByStage: bundle.markdownByStage,
            manifest: runtimeManifest,
            handler,
          });
        }
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
