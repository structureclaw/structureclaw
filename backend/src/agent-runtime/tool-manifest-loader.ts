import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { formatManifestIssues, toolManifestFileSchema, type ToolManifestFile } from './manifest-schema.js';

export interface LoadedToolManifest extends ToolManifestFile {
  manifestPath: string;
}

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
  return result.sort((left, right) => left.localeCompare(right));
}

function readManifest(manifestPath: string): unknown {
  try {
    return parseYaml(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid tool manifest at ${manifestPath}: ${message}`);
  }
}

export async function loadToolManifestsFromDirectory(rootDir: string): Promise<LoadedToolManifest[]> {
  const manifests: LoadedToolManifest[] = [];

  for (const directory of collectDirectories(rootDir)) {
    const manifestPath = path.join(directory, 'tool.yaml');
    if (!existsSync(manifestPath)) {
      continue;
    }

    const parsed = toolManifestFileSchema.safeParse(readManifest(manifestPath));
    if (!parsed.success) {
      throw new Error(`Invalid tool manifest at ${manifestPath}: ${formatManifestIssues(parsed.error)}`);
    }

    manifests.push({
      ...parsed.data,
      manifestPath,
    });
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}
