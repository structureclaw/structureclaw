export const GEOMETRY_KEYS = [
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

export const LOAD_BOUNDARY_KEYS = ['floorLoads', 'frameBaseSupportType'] as const;

export const REQUIRED_KEYS = [
  'frameDimension',
  'storyCount',
  'bayCount',
  'bayCountX',
  'bayCountY',
  'storyHeightsM',
  'bayWidthsM',
  'bayWidthsXM',
  'bayWidthsYM',
  'floorLoads',
] as const;

export const FRAME_MATERIAL_KEYS = ['frameMaterial', 'frameColumnSection', 'frameBeamSection'] as const;
