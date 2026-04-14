import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { formatManifestIssues, skillManifestFileSchema, type SkillManifestFile } from './manifest-schema.js';
import type { SkillDomain, SkillManifest } from './types.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface LoadedSkillManifest extends SkillManifestFile {
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

function hasSkillManifestInDescendants(rootDir: string): boolean {
  return collectDirectories(rootDir).some((directory) => existsSync(path.join(directory, 'skill.yaml')));
}

export function resolveBuiltinSkillManifestRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'backend/dist/agent-skills'),
    path.resolve(process.cwd(), 'dist/agent-skills'),
    path.resolve(process.cwd(), 'backend/src/agent-skills'),
    path.resolve(process.cwd(), 'src/agent-skills'),
    path.resolve(MODULE_DIR, '../../agent-skills'),
    path.resolve(MODULE_DIR, '../../src/agent-skills'),
  ];
  const matched = candidates.find((candidate) => hasSkillManifestInDescendants(candidate));
  if (!matched) {
    throw new Error(`Builtin skill manifest directory not found. Tried: ${candidates.join(', ')}`);
  }
  return matched;
}

function readManifest(manifestPath: string): unknown {
  try {
    return parseYaml(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid skill manifest at ${manifestPath}: ${message}`);
  }
}

function loadSkillManifestsFromDirectoryInternal(rootDir: string): LoadedSkillManifest[] {
  const manifests: LoadedSkillManifest[] = [];

  for (const directory of collectDirectories(rootDir)) {
    const manifestPath = path.join(directory, 'skill.yaml');
    if (!existsSync(manifestPath)) {
      continue;
    }

    const parsed = skillManifestFileSchema.safeParse(readManifest(manifestPath));
    if (!parsed.success) {
      throw new Error(`Invalid skill manifest at ${manifestPath}: ${formatManifestIssues(parsed.error)}`);
    }

    manifests.push({
      ...parsed.data,
      manifestPath,
    });
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadSkillManifestsFromDirectory(rootDir: string): Promise<LoadedSkillManifest[]> {
  return loadSkillManifestsFromDirectoryInternal(rootDir);
}

export function loadSkillManifestsFromDirectorySync(rootDir: string): LoadedSkillManifest[] {
  return loadSkillManifestsFromDirectoryInternal(rootDir);
}

export function toRuntimeSkillManifest(manifest: LoadedSkillManifest): SkillManifest {
  return {
    id: manifest.id,
    domain: manifest.domain as SkillDomain,
    name: manifest.name,
    description: manifest.description,
    triggers: [...manifest.triggers],
    stages: [...manifest.stages],
    autoLoadByDefault: manifest.autoLoadByDefault,
    structureType: manifest.structureType as SkillManifest['structureType'],
    structuralTypeKeys: [...manifest.structuralTypeKeys] as SkillManifest['structuralTypeKeys'],
    requires: [...manifest.requires],
    conflicts: [...manifest.conflicts],
    capabilities: [...manifest.capabilities],
    enabledTools: [...manifest.grants],
    providedTools: [...manifest.providesTools],
    supportedAnalysisTypes: [...manifest.supportedAnalysisTypes] as SkillManifest['supportedAnalysisTypes'],
    supportedModelFamilies: [...manifest.supportedModelFamilies],
    materialFamilies: [...manifest.materialFamilies] as SkillManifest['materialFamilies'],
    priority: manifest.priority,
    compatibility: { ...manifest.compatibility },
    runtimeContract: manifest.runtimeContract,
  };
}
