import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadToolManifestsFromDirectory,
  resolveBuiltinToolManifestRoot,
  type LoadedToolManifest,
} from '../agent-runtime/tool-manifest-loader.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function collectDirectories(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }
  const result: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(current);
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
  return result;
}

function hasToolManifestInDescendants(rootDir: string): boolean {
  return collectDirectories(rootDir).some((directory) => existsSync(path.join(directory, 'tool.yaml')));
}

function resolveBuiltinToolRoot(): string {
  const moduleRelativeRoot = path.resolve(MODULE_DIR, '../../agent-tools');
  if (hasToolManifestInDescendants(moduleRelativeRoot)) {
    return moduleRelativeRoot;
  }
  return resolveBuiltinToolManifestRoot();
}

export class AgentToolCatalogService {
  private builtinToolsPromise: Promise<LoadedToolManifest[]> | null = null;

  constructor(private readonly builtinToolRoot = resolveBuiltinToolRoot()) {}

  async listBuiltinTools(): Promise<LoadedToolManifest[]> {
    if (!this.builtinToolsPromise) {
      this.builtinToolsPromise = loadToolManifestsFromDirectory(this.builtinToolRoot);
    }
    return this.builtinToolsPromise;
  }
}

export default AgentToolCatalogService;
