import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadToolManifestsFromDirectory, type LoadedToolManifest } from '../agent-runtime/tool-manifest-loader.js';

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
  const candidates = [
    path.resolve(process.cwd(), 'backend/dist/agent-tools'),
    path.resolve(process.cwd(), 'dist/agent-tools'),
    path.resolve(process.cwd(), 'backend/src/agent-tools'),
    path.resolve(process.cwd(), 'src/agent-tools'),
    path.resolve(MODULE_DIR, '../../agent-tools'),
    path.resolve(MODULE_DIR, '../../src/agent-tools'),
  ];
  const matched = candidates.find((candidate) => hasToolManifestInDescendants(candidate));
  if (!matched) {
    throw new Error(`Builtin tool manifest directory not found. Tried: ${candidates.join(', ')}`);
  }
  return matched;
}

export class AgentToolCatalogService {
  constructor(private readonly builtinToolRoot = resolveBuiltinToolRoot()) {}

  async listBuiltinTools(): Promise<LoadedToolManifest[]> {
    return loadToolManifestsFromDirectory(this.builtinToolRoot);
  }
}

export default AgentToolCatalogService;
