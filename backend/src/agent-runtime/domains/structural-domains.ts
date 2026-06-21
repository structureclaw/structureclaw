import type { DraftExtraction } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used via typeof for type inference
const GEOMETRY_DOMAIN_KEYS = [
  'lengthM',
  'spanLengthM',
  'heightM',
  'frameDimension',
  'storyCount',
  'bayCount',
  'bayCountX',
  'bayCountY',
  'storyHeightsM',
  'bayWidthsM',
  'bayWidthsXM',
  'bayWidthsYM',
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used via typeof for type inference
const LOAD_BOUNDARY_DOMAIN_KEYS = [
  'supportType',
  'frameBaseSupportType',
  'loadKN',
  'loadType',
  'loadPosition',
  'loadPositionM',
  'floorLoads',
] as const;

type GeometryDomainKey = typeof GEOMETRY_DOMAIN_KEYS[number];
type LoadBoundaryDomainKey = typeof LOAD_BOUNDARY_DOMAIN_KEYS[number];

function pickKeys<T extends string>(
  patch: DraftExtraction,
  keys: readonly T[],
): Partial<Record<T, unknown>> {
  const next: Partial<Record<T, unknown>> = {};
  for (const key of keys) {
    const value = patch[key];
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function projectGeometryDomain(
  patch: DraftExtraction,
  keys: readonly GeometryDomainKey[],
  options?: { spanLengthAliasFromLength?: boolean },
): DraftExtraction {
  const geometry = pickKeys(patch, keys) as DraftExtraction;
  if (options?.spanLengthAliasFromLength && geometry.spanLengthM === undefined && patch.lengthM !== undefined) {
    geometry.spanLengthM = patch.lengthM;
  }
  return geometry;
}

function projectLoadBoundaryDomain(
  patch: DraftExtraction,
  keys: readonly LoadBoundaryDomainKey[],
): DraftExtraction {
  return pickKeys(patch, keys) as DraftExtraction;
}

export function composeStructuralDomainPatch(options: {
  patch: DraftExtraction;
  geometryKeys: readonly GeometryDomainKey[];
  loadBoundaryKeys: readonly LoadBoundaryDomainKey[];
  spanLengthAliasFromLength?: boolean;
}): DraftExtraction {
  const geometry = projectGeometryDomain(options.patch, options.geometryKeys, {
    spanLengthAliasFromLength: options.spanLengthAliasFromLength,
  });
  const loadBoundary = projectLoadBoundaryDomain(options.patch, options.loadBoundaryKeys);
  return {
    ...geometry,
    ...loadBoundary,
    ...(options.patch.engineeringDraft !== undefined && { engineeringDraft: options.patch.engineeringDraft }),
    ...(options.patch.draftIssues !== undefined && { draftIssues: options.patch.draftIssues }),
    ...(options.patch.skillState !== undefined && { skillState: options.patch.skillState }),
  };
}

export function combineDomainKeys(
  geometryKeys: readonly GeometryDomainKey[],
  loadBoundaryKeys: readonly LoadBoundaryDomainKey[],
): string[] {
  return Array.from(new Set([...geometryKeys, ...loadBoundaryKeys]));
}
