/** Frame-family geometry keys used by the 2D composite frame elevation. */
export const GEOMETRY_KEYS = ['storyCount', 'storyHeightsM', 'bayCount', 'bayWidthsM'] as const;

export const LOAD_BOUNDARY_KEYS = ['floorLoads', 'frameBaseSupportType'] as const;

/** Keys computed by computeLegacyMissing for the frame family (frameDimension is pinned to '2d'). */
export const REQUIRED_KEYS = [...GEOMETRY_KEYS, 'floorLoads'] as const;

/** Composite-specific draft keys. */
export const COMPOSITE_GEOMETRY_KEYS = ['compositeSlabThicknessMm', 'compositeSlabWidthM'] as const;
export const COMPOSITE_SECTION_KEYS = ['compositeSteelBeamSection', 'compositeSteelColumnSection'] as const;
export const COMPOSITE_MATERIAL_KEYS = ['compositeSteelGrade', 'compositeConcreteGrade'] as const;
export const COMPOSITE_STUD_KEYS = ['compositeStudDiameterMm'] as const;

export const ALLOWED_KEYS = [
  ...REQUIRED_KEYS,
  ...LOAD_BOUNDARY_KEYS,
  ...COMPOSITE_GEOMETRY_KEYS,
  ...COMPOSITE_SECTION_KEYS,
  ...COMPOSITE_MATERIAL_KEYS,
  ...COMPOSITE_STUD_KEYS,
] as const;

/** Restriction list handed to restrictLegacyDraftPatch (composite keys are extracted separately). */
export const LEGACY_ALLOWED_KEYS = [
  'frameDimension',
  'storyCount',
  'storyHeightsM',
  'bayCount',
  'bayWidthsM',
  'floorLoads',
  'frameBaseSupportType',
  'siteSeismic',
] as const;

/** Default material grades (steel default aligned with the frame skill). */
export const DEFAULT_STEEL_GRADE = 'Q355';
export const DEFAULT_CONCRETE_GRADE = 'C30';
export const DEFAULT_STUD_DIAMETER_MM = 19;
export const DEFAULT_STUD_ROWS = 2;
/** GB 50017 stud tensile strength assumption for design-basis estimates (N/mm²). */
export const STUD_TENSILE_STRENGTH_NMM2 = 400;

/** Effective flange width: be = b0 + 2·min(L/6, 6·hc), rounded up to 50 mm. */
export const EFFECTIVE_WIDTH_SPAN_FACTOR = 6;
export const EFFECTIVE_WIDTH_SLAB_FACTOR = 6;
export const EFFECTIVE_WIDTH_ROUND_MM = 50;

/** Stud pitch bounds: 3× shank diameter minimum, 600 mm maximum. */
export const STUD_PITCH_MIN_DIAMETER_FACTOR = 3;
export const STUD_PITCH_MAX_MM = 600;
export const STUD_PITCH_ROUND_MM = 10;

/** Absolute minimum composite slab thickness (mm) for design-basis estimates. */
export const MIN_SLAB_THICKNESS_MM = 100;

/** Parse a positive finite number from loose scalar input. */
export function toPositiveNumberFromUnknown(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
