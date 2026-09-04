import type { WallOpeningSpec } from './types.js';

/** Geometry keys shared with the frame family (subset relevant to wall elevations). */
export const GEOMETRY_KEYS = ['storyCount', 'storyHeightsM'] as const;

export const LOAD_BOUNDARY_KEYS = ['floorLoads', 'frameBaseSupportType'] as const;

/** Keys computed by computeLegacyMissing for the frame family. */
export const REQUIRED_KEYS = [...GEOMETRY_KEYS, 'floorLoads'] as const;

/** Shear-wall specific draft keys. */
export const WALL_MATERIAL_KEYS = ['wallConcreteGrade', 'wallRebarGrade'] as const;
export const WALL_GEOMETRY_KEYS = ['wallLengthM', 'wallThicknessMm'] as const;
export const WALL_OPTIONAL_KEYS = ['wallOpenings', 'seismicGrade'] as const;

export const ALLOWED_KEYS = [
  ...REQUIRED_KEYS,
  ...LOAD_BOUNDARY_KEYS,
  ...WALL_MATERIAL_KEYS,
  ...WALL_GEOMETRY_KEYS,
  ...WALL_OPTIONAL_KEYS,
] as const;

/** Absolute minimum wall thickness (mm) per seismic grade — GB/T 50011 6.4.1. */
export const MIN_WALL_THICKNESS_MM = { grade12: 160, grade34: 140 } as const;

/** Story-height ratio minimum wall thickness — GB/T 50011 6.4.1. */
export const WALL_THICKNESS_STORY_RATIO = { grade12: 20, grade34: 25 } as const;

/** Bottom strengthened zone limits (grade 1/2) — GB/T 50011 6.4.1. */
export const BOTTOM_ZONE_MIN_THICKNESS_MM = 200;
export const BOTTOM_ZONE_STORY_RATIO = 16;
export const BOTTOM_ZONE_NO_END_COLUMN_RATIO = 12;

/** Coupling beam span-to-depth ratio band (JGJ 3-2010 7.2.22–7.2.24 practice). */
export const COUPLING_BEAM_MIN_SPAN_DEPTH_RATIO = 2;
export const COUPLING_BEAM_MAX_SPAN_DEPTH_RATIO = 5;
export const COUPLING_BEAM_MIN_HEIGHT_MM = 400;

/** Distributed reinforcement minimum ratios per seismic grade — GB/T 50011 6.4.3. */
export const DISTRIBUTED_REINFORCEMENT_RATIO: Record<number, number> = {
  1: 0.0025,
  2: 0.0025,
  3: 0.0025,
  4: 0.002,
};

/** Default material grades (aligned with concrete-frame skill defaults). */
export const DEFAULT_CONCRETE_GRADE = 'C30';
export const DEFAULT_REBAR_GRADE = 'HRB400';

/** Normalize an empty openings array to undefined so callers can distinguish "not provided". */
export function normalizeWallOpenings(value: unknown): WallOpeningSpec[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const openings: WallOpeningSpec[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const width = toPositiveNumber(record.widthM ?? record.width_m ?? record.width);
    const height = toPositiveNumber(record.heightM ?? record.height_m ?? record.height);
    if (width === undefined || height === undefined) continue;
    const x = toPositiveNumber(record.xM ?? record.x_m ?? record.x);
    const sill = toNonNegativeNumber(record.sillM ?? record.sill_m ?? record.sill);
    openings.push({
      ...(x !== undefined && { xM: x }),
      widthM: width,
      heightM: height,
      ...(sill !== undefined && { sillM: sill }),
    });
  }
  return openings.length ? openings : undefined;
}

export function toPositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function toNonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
