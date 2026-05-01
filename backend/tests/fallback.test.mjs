import { describe, expect, it, test } from '@jest/globals';
import {
  normalizeLoadType,
  normalizeSupportType,
  normalizeLoadPosition,
  normalizeLoadPositionM,
  normalizeInferredType,
  normalizeFrameDimension,
  normalizeFrameBaseSupportType,
  normalizeNumber,
  normalizePositiveInteger,
  normalizeNumberArray,
  normalizeFloorLoads,
  buildUnknownStructuralType,
  detectUnsupportedStructuralTypeByRules,
  mergeDraftState,
  buildInteractionQuestions,
  buildModel,
} from '../dist/agent-runtime/fallback.js';

// ---------------------------------------------------------------------------
// normalizeLoadType
// ---------------------------------------------------------------------------
describe('normalizeLoadType', () => {
  it('should accept "point"', () => {
    expect(normalizeLoadType('point')).toBe('point');
  });

  it('should accept "distributed"', () => {
    expect(normalizeLoadType('distributed')).toBe('distributed');
  });

  it('should return undefined for unrecognized strings', () => {
    expect(normalizeLoadType('uniform')).toBeUndefined();
    expect(normalizeLoadType('')).toBeUndefined();
  });

  it('should return undefined for non-string values', () => {
    expect(normalizeLoadType(42)).toBeUndefined();
    expect(normalizeLoadType(null)).toBeUndefined();
    expect(normalizeLoadType(undefined)).toBeUndefined();
    expect(normalizeLoadType(true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeSupportType
// ---------------------------------------------------------------------------
describe('normalizeSupportType', () => {
  it('should accept all four valid support types', () => {
    expect(normalizeSupportType('cantilever')).toBe('cantilever');
    expect(normalizeSupportType('simply-supported')).toBe('simply-supported');
    expect(normalizeSupportType('fixed-fixed')).toBe('fixed-fixed');
    expect(normalizeSupportType('fixed-pinned')).toBe('fixed-pinned');
  });

  it('should return undefined for unrecognized strings', () => {
    expect(normalizeSupportType('pinned')).toBeUndefined();
    expect(normalizeSupportType('')).toBeUndefined();
  });

  it('should return undefined for non-string values', () => {
    expect(normalizeSupportType(123)).toBeUndefined();
    expect(normalizeSupportType(null)).toBeUndefined();
    expect(normalizeSupportType(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeLoadPosition
// ---------------------------------------------------------------------------
describe('normalizeLoadPosition', () => {
  it('should accept all six valid positions', () => {
    expect(normalizeLoadPosition('end')).toBe('end');
    expect(normalizeLoadPosition('midspan')).toBe('midspan');
    expect(normalizeLoadPosition('full-span')).toBe('full-span');
    expect(normalizeLoadPosition('top-nodes')).toBe('top-nodes');
    expect(normalizeLoadPosition('middle-joint')).toBe('middle-joint');
    expect(normalizeLoadPosition('free-joint')).toBe('free-joint');
  });

  it('should return undefined for unrecognized values', () => {
    expect(normalizeLoadPosition('center')).toBeUndefined();
    expect(normalizeLoadPosition('')).toBeUndefined();
    expect(normalizeLoadPosition(null)).toBeUndefined();
    expect(normalizeLoadPosition(5)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeLoadPositionM
// ---------------------------------------------------------------------------
describe('normalizeLoadPositionM', () => {
  it('should accept a positive number', () => {
    expect(normalizeLoadPositionM(3.5)).toBe(3.5);
    expect(normalizeLoadPositionM(0)).toBe(0);
  });

  it('should parse a positive numeric string', () => {
    expect(normalizeLoadPositionM('2.0')).toBe(2);
  });

  it('should reject negative values', () => {
    expect(normalizeLoadPositionM(-1)).toBeUndefined();
    expect(normalizeLoadPositionM('-3')).toBeUndefined();
  });

  it('should reject non-numeric values', () => {
    expect(normalizeLoadPositionM('abc')).toBeUndefined();
    expect(normalizeLoadPositionM(null)).toBeUndefined();
    expect(normalizeLoadPositionM(NaN)).toBeUndefined();
    expect(normalizeLoadPositionM(Infinity)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeInferredType
// ---------------------------------------------------------------------------
describe('normalizeInferredType', () => {
  it('should accept all valid inferred types', () => {
    expect(normalizeInferredType('beam')).toBe('beam');
    expect(normalizeInferredType('truss')).toBe('truss');
    expect(normalizeInferredType('portal-frame')).toBe('portal-frame');
    expect(normalizeInferredType('double-span-beam')).toBe('double-span-beam');
    expect(normalizeInferredType('frame')).toBe('frame');
    expect(normalizeInferredType('unknown')).toBe('unknown');
  });

  it('should return undefined for invalid types', () => {
    expect(normalizeInferredType('slab')).toBeUndefined();
    expect(normalizeInferredType('')).toBeUndefined();
    expect(normalizeInferredType(42)).toBeUndefined();
    expect(normalizeInferredType(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeFrameDimension
// ---------------------------------------------------------------------------
describe('normalizeFrameDimension', () => {
  it('should accept "2d" and "3d"', () => {
    expect(normalizeFrameDimension('2d')).toBe('2d');
    expect(normalizeFrameDimension('3d')).toBe('3d');
  });

  it('should reject everything else', () => {
    expect(normalizeFrameDimension('2D')).toBeUndefined();
    expect(normalizeFrameDimension('4d')).toBeUndefined();
    expect(normalizeFrameDimension('')).toBeUndefined();
    expect(normalizeFrameDimension(null)).toBeUndefined();
    expect(normalizeFrameDimension(2)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeFrameBaseSupportType
// ---------------------------------------------------------------------------
describe('normalizeFrameBaseSupportType', () => {
  it('should accept "fixed" and "pinned"', () => {
    expect(normalizeFrameBaseSupportType('fixed')).toBe('fixed');
    expect(normalizeFrameBaseSupportType('pinned')).toBe('pinned');
  });

  it('should reject invalid values', () => {
    expect(normalizeFrameBaseSupportType('roller')).toBeUndefined();
    expect(normalizeFrameBaseSupportType('')).toBeUndefined();
    expect(normalizeFrameBaseSupportType(null)).toBeUndefined();
    expect(normalizeFrameBaseSupportType(0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeNumber
// ---------------------------------------------------------------------------
describe('normalizeNumber', () => {
  it('should return finite numbers as-is', () => {
    expect(normalizeNumber(0)).toBe(0);
    expect(normalizeNumber(3.14)).toBe(3.14);
    expect(normalizeNumber(-5)).toBe(-5);
  });

  it('should parse numeric strings', () => {
    expect(normalizeNumber('10')).toBe(10);
    expect(normalizeNumber('-2.5')).toBe(-2.5);
    expect(normalizeNumber('0')).toBe(0);
  });

  it('should return undefined for NaN and Infinity', () => {
    expect(normalizeNumber(NaN)).toBeUndefined();
    expect(normalizeNumber(Infinity)).toBeUndefined();
    expect(normalizeNumber(-Infinity)).toBeUndefined();
  });

  it('should return undefined for non-numeric strings', () => {
    expect(normalizeNumber('abc')).toBeUndefined();
    expect(normalizeNumber('')).toBeUndefined();
  });

  it('should return undefined for objects, arrays, null, undefined, booleans', () => {
    expect(normalizeNumber(null)).toBeUndefined();
    expect(normalizeNumber(undefined)).toBeUndefined();
    expect(normalizeNumber(true)).toBeUndefined();
    expect(normalizeNumber({})).toBeUndefined();
    expect(normalizeNumber([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizePositiveInteger
// ---------------------------------------------------------------------------
describe('normalizePositiveInteger', () => {
  it('should round and return positive integers', () => {
    expect(normalizePositiveInteger(3)).toBe(3);
    expect(normalizePositiveInteger(3.7)).toBe(4);
    expect(normalizePositiveInteger(3.2)).toBe(3);
    expect(normalizePositiveInteger(1)).toBe(1);
  });

  it('should parse strings and round', () => {
    expect(normalizePositiveInteger('5')).toBe(5);
    expect(normalizePositiveInteger('2.8')).toBe(3);
  });

  it('should reject zero and negative values', () => {
    expect(normalizePositiveInteger(0)).toBeUndefined();
    expect(normalizePositiveInteger(-1)).toBeUndefined();
    expect(normalizePositiveInteger('-5')).toBeUndefined();
  });

  it('should reject non-numeric values', () => {
    expect(normalizePositiveInteger('abc')).toBeUndefined();
    expect(normalizePositiveInteger(null)).toBeUndefined();
    expect(normalizePositiveInteger(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeNumberArray
// ---------------------------------------------------------------------------
describe('normalizeNumberArray', () => {
  it('should normalize a valid number array, filtering non-positive', () => {
    expect(normalizeNumberArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('should parse strings within the array', () => {
    expect(normalizeNumberArray(['4', '5'])).toEqual([4, 5]);
  });

  it('should filter out non-positive, NaN, and Infinity entries', () => {
    expect(normalizeNumberArray([0, -1, 3, NaN, Infinity, 4])).toEqual([3, 4]);
  });

  it('should filter out non-numeric entries', () => {
    expect(normalizeNumberArray([1, 'abc', null, undefined, true, 2])).toEqual([1, 2]);
  });

  it('should return undefined when result array is empty', () => {
    expect(normalizeNumberArray([])).toBeUndefined();
    expect(normalizeNumberArray([0, -1, 'x'])).toBeUndefined();
  });

  it('should return undefined for non-array input', () => {
    expect(normalizeNumberArray('1,2,3')).toBeUndefined();
    expect(normalizeNumberArray(null)).toBeUndefined();
    expect(normalizeNumberArray(undefined)).toBeUndefined();
    expect(normalizeNumberArray(42)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeFloorLoads
// ---------------------------------------------------------------------------
describe('normalizeFloorLoads', () => {
  it('should normalize valid floor load objects', () => {
    const input = [
      { story: 1, verticalKN: 10 },
      { story: 2, lateralXKN: 5 },
    ];
    const result = normalizeFloorLoads(input);
    expect(result).toEqual([
      { story: 1, verticalKN: 10, liveLoadKN: undefined, lateralXKN: undefined, lateralYKN: undefined },
      { story: 2, verticalKN: undefined, liveLoadKN: undefined, lateralXKN: 5, lateralYKN: undefined },
    ]);
  });

  it('should accept string story numbers as positive integers', () => {
    const input = [{ story: '3', verticalKN: 20 }];
    const result = normalizeFloorLoads(input);
    expect(result).toEqual([{ story: 3, verticalKN: 20, liveLoadKN: undefined, lateralXKN: undefined, lateralYKN: undefined }]);
  });

  it('should preserve live load fields', () => {
    const input = [{ story: 1, verticalKN: 288, liveLoadKN: 144 }];
    const result = normalizeFloorLoads(input);
    expect(result).toEqual([{ story: 1, verticalKN: 288, liveLoadKN: 144, lateralXKN: undefined, lateralYKN: undefined }]);
  });

  it('should reject items with no load fields', () => {
    const input = [{ story: 1 }];
    expect(normalizeFloorLoads(input)).toBeUndefined();
  });

  it('should infer missing story from array order', () => {
    const input = [{ verticalKN: 10 }, { verticalKN: 20 }];
    expect(normalizeFloorLoads(input)).toEqual([
      { story: 1, verticalKN: 10, liveLoadKN: undefined, lateralXKN: undefined, lateralYKN: undefined },
      { story: 2, verticalKN: 20, liveLoadKN: undefined, lateralXKN: undefined, lateralYKN: undefined },
    ]);
  });

  it('should not infer missing stories when explicit stories are mixed in', () => {
    const input = [{ story: 2, verticalKN: 20 }, { verticalKN: 30 }];
    expect(normalizeFloorLoads(input)).toEqual([
      { story: 2, verticalKN: 20, liveLoadKN: undefined, lateralXKN: undefined, lateralYKN: undefined },
    ]);
  });

  it('should reject non-object items', () => {
    const input = [42, 'hello', null, true];
    expect(normalizeFloorLoads(input)).toBeUndefined();
  });

  it('should return undefined for non-array input', () => {
    expect(normalizeFloorLoads('not array')).toBeUndefined();
    expect(normalizeFloorLoads(null)).toBeUndefined();
    expect(normalizeFloorLoads(undefined)).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    expect(normalizeFloorLoads([])).toBeUndefined();
  });

  it('should mix valid and invalid items, keeping only valid', () => {
    const input = [
      { story: 1, verticalKN: 10 },
      { story: 'bad' },
      { story: 2, lateralYKN: 3 },
    ];
    const result = normalizeFloorLoads(input);
    expect(result).toHaveLength(2);
    expect(result[0].story).toBe(1);
    expect(result[1].story).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildUnknownStructuralType
// ---------------------------------------------------------------------------
describe('buildUnknownStructuralType', () => {
  it('should return a StructuralTypeMatch with key "unknown" for English locale', () => {
    const result = buildUnknownStructuralType('en');
    expect(result.key).toBe('unknown');
    expect(result.mappedType).toBe('unknown');
    expect(result.supportLevel).toBe('unsupported');
    expect(result.supportNote).toContain('I have not yet refined');
  });

  it('should return Chinese note for zh locale', () => {
    const result = buildUnknownStructuralType('zh');
    expect(result.supportNote).toContain('\u6211\u8FD8\u6CA1\u6709\u4ECE\u5F53\u524D\u63CF\u8FF0\u4E2D');
  });
});

// ---------------------------------------------------------------------------
// detectUnsupportedStructuralTypeByRules
// ---------------------------------------------------------------------------
describe('detectUnsupportedStructuralTypeByRules', () => {
  it('should detect "space frame" in English', () => {
    const result = detectUnsupportedStructuralTypeByRules('I want a space frame structure', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('space-frame');
    expect(result.supportLevel).toBe('unsupported');
  });

  it('should detect Chinese term for space frame', () => {
    const result = detectUnsupportedStructuralTypeByRules('\u7F51\u67B6\u7ED3\u6784', 'zh');
    expect(result).not.toBeNull();
    expect(result.key).toBe('space-frame');
  });

  it('should detect "slab" keyword', () => {
    const result = detectUnsupportedStructuralTypeByRules('I need a concrete slab', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('plate-slab');
  });

  it('should detect "plate" keyword', () => {
    const result = detectUnsupportedStructuralTypeByRules('flat plate model', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('plate-slab');
  });

  it('should detect Chinese term for slab', () => {
    const result = detectUnsupportedStructuralTypeByRules('\u697C\u677F\u8BBE\u8BA1', 'zh');
    expect(result).not.toBeNull();
    expect(result.key).toBe('plate-slab');
  });

  it('should detect Chinese character for plate/slab', () => {
    const result = detectUnsupportedStructuralTypeByRules('\u677F\u7ED3\u6784', 'zh');
    expect(result).not.toBeNull();
    expect(result.key).toBe('plate-slab');
  });

  it('should detect "shell" keyword', () => {
    const result = detectUnsupportedStructuralTypeByRules('thin shell structure', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('shell');
  });

  it('should detect Chinese term for shell', () => {
    const result = detectUnsupportedStructuralTypeByRules('\u58F3\u4F53\u7ED3\u6784', 'zh');
    expect(result).not.toBeNull();
    expect(result.key).toBe('shell');
  });

  it('should detect "tower" keyword', () => {
    const result = detectUnsupportedStructuralTypeByRules('transmission tower analysis', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('tower');
  });

  it('should detect Chinese term for tower', () => {
    const result = detectUnsupportedStructuralTypeByRules('\u5854\u67B6\u8BBE\u8BA1', 'zh');
    expect(result).not.toBeNull();
    expect(result.key).toBe('tower');
  });

  it('should detect "bridge" keyword', () => {
    const result = detectUnsupportedStructuralTypeByRules('cable-stayed bridge model', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('bridge');
  });

  it('should detect Chinese term for bridge', () => {
    const result = detectUnsupportedStructuralTypeByRules('\u6865\u6881\u7ED3\u6784', 'zh');
    expect(result).not.toBeNull();
    expect(result.key).toBe('bridge');
  });

  it('should return null when no unsupported type is matched', () => {
    expect(detectUnsupportedStructuralTypeByRules('simple beam analysis', 'en')).toBeNull();
    expect(detectUnsupportedStructuralTypeByRules('\u7B80\u652F\u6881\u8BA1\u7B97', 'zh')).toBeNull();
    expect(detectUnsupportedStructuralTypeByRules('', 'en')).toBeNull();
  });

  it('should be case-insensitive', () => {
    const result = detectUnsupportedStructuralTypeByRules('Space Frame Structure', 'en');
    expect(result).not.toBeNull();
    expect(result.key).toBe('space-frame');
  });

  it('should prioritize space-frame before slab before shell before tower before bridge', () => {
    // "space frame slab" contains both space frame and slab, but space frame should win
    const result = detectUnsupportedStructuralTypeByRules('space frame slab', 'en');
    expect(result.key).toBe('space-frame');
  });
});

// ---------------------------------------------------------------------------
// mergeDraftState
// ---------------------------------------------------------------------------
describe('mergeDraftState', () => {
  it('should merge a patch into an empty (undefined) existing state', () => {
    const patch = { inferredType: 'beam', lengthM: 6 };
    const result = mergeDraftState(undefined, patch);
    expect(result.inferredType).toBe('beam');
    expect(result.lengthM).toBe(6);
    expect(typeof result.updatedAt).toBe('number');
  });

  it('should prefer patch values over existing state', () => {
    const existing = {
      inferredType: 'beam',
      lengthM: 5,
      loadKN: 10,
      updatedAt: Date.now(),
    };
    const patch = { lengthM: 8, loadKN: 20 };
    const result = mergeDraftState(existing, patch);
    expect(result.lengthM).toBe(8);
    expect(result.loadKN).toBe(20);
    expect(result.inferredType).toBe('beam');
  });

  it('should keep existing values when patch does not override', () => {
    const existing = {
      inferredType: 'truss',
      lengthM: 10,
      heightM: 3,
      updatedAt: Date.now(),
    };
    const patch = { lengthM: 12 };
    const result = mergeDraftState(existing, patch);
    expect(result.heightM).toBe(3);
    expect(result.lengthM).toBe(12);
    expect(result.inferredType).toBe('truss');
  });

  it('should treat "unknown" inferredType in patch as absent', () => {
    const existing = {
      inferredType: 'beam',
      lengthM: 6,
      updatedAt: Date.now(),
    };
    const patch = { inferredType: 'unknown' };
    const result = mergeDraftState(existing, patch);
    expect(result.inferredType).toBe('beam');
  });

  it('should default to "unknown" when no type is set anywhere', () => {
    const result = mergeDraftState(undefined, {});
    expect(result.inferredType).toBe('unknown');
  });

  it('should derive spanLengthM from lengthM for portal-frame', () => {
    const result = mergeDraftState(undefined, { inferredType: 'portal-frame', lengthM: 12, heightM: 5 });
    expect(result.spanLengthM).toBe(12);
  });

  it('should derive spanLengthM from lengthM for double-span-beam', () => {
    const result = mergeDraftState(undefined, { inferredType: 'double-span-beam', lengthM: 8 });
    expect(result.spanLengthM).toBe(8);
  });

  it('should not derive spanLengthM for beam type', () => {
    const result = mergeDraftState(undefined, { inferredType: 'beam', lengthM: 6 });
    expect(result.spanLengthM).toBeUndefined();
  });

  it('should use explicit spanLengthM over derived value', () => {
    const result = mergeDraftState(undefined, { inferredType: 'portal-frame', lengthM: 12, spanLengthM: 10 });
    expect(result.spanLengthM).toBe(10);
  });

  it('should infer storyCount from storyHeightsM length', () => {
    const result = mergeDraftState(undefined, { storyHeightsM: [3, 3, 3] });
    expect(result.storyCount).toBe(3);
  });

  it('should infer bayCount from bayWidthsM length', () => {
    const result = mergeDraftState(undefined, { bayWidthsM: [6, 6] });
    expect(result.bayCount).toBe(2);
  });

  it('should repeat heightM into storyHeightsM when storyCount is set', () => {
    const result = mergeDraftState(undefined, { storyCount: 3, heightM: 4 });
    expect(result.storyHeightsM).toEqual([4, 4, 4]);
  });

  it('should handle 2D frame bayWidthsM derivation from lengthM', () => {
    const result = mergeDraftState(undefined, {
      inferredType: 'frame',
      frameDimension: '2d',
      bayCount: 2,
      lengthM: 12,
      storyCount: 1,
      heightM: 3,
    });
    expect(result.bayWidthsM).toEqual([12, 12]);
  });

  it('should clear bayWidthsM for 3d frame', () => {
    const result = mergeDraftState(undefined, {
      inferredType: 'frame',
      frameDimension: '3d',
      bayCountX: 2,
      bayCountY: 3,
    });
    expect(result.bayWidthsM).toBeUndefined();
    expect(result.bayWidthsXM).toBeUndefined();
    expect(result.bayWidthsYM).toBeUndefined();
  });

  it('should keep bayWidthsXM and bayWidthsYM for 3d frame', () => {
    const result = mergeDraftState(undefined, {
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [5, 5],
      bayWidthsYM: [4, 4, 4],
    });
    expect(result.bayWidthsXM).toEqual([5, 5]);
    expect(result.bayWidthsYM).toEqual([4, 4, 4]);
  });

  it('should build uniform floor loads from storyCount and loadKN', () => {
    const result = mergeDraftState(undefined, { storyCount: 2, loadKN: 15 });
    expect(result.floorLoads).toEqual([
      { story: 1, verticalKN: 15, lateralXKN: undefined, lateralYKN: undefined },
      { story: 2, verticalKN: 15, lateralXKN: undefined, lateralYKN: undefined },
    ]);
  });

  it('should merge floor loads from existing and patch', () => {
    const existing = {
      inferredType: 'frame',
      frameDimension: '2d',
      storyCount: 2,
      floorLoads: [
        { story: 1, verticalKN: 10 },
        { story: 2, verticalKN: 20 },
      ],
      updatedAt: Date.now(),
    };
    const patch = {
      floorLoads: [{ story: 1, lateralXKN: 5 }],
    };
    const result = mergeDraftState(existing, patch);
    expect(result.floorLoads).toHaveLength(2);
    const story1 = result.floorLoads.find((l) => l.story === 1);
    expect(story1.verticalKN).toBe(10);
    expect(story1.lateralXKN).toBe(5);
  });

  it('should merge live floor loads from existing and patch', () => {
    const existing = {
      inferredType: 'frame',
      frameDimension: '2d',
      storyCount: 1,
      floorLoads: [{ story: 1, verticalKN: 288 }],
      updatedAt: Date.now(),
    };
    const patch = {
      floorLoads: [{ story: 1, liveLoadKN: 144 }],
    };
    const result = mergeDraftState(existing, patch);
    expect(result.floorLoads).toEqual([
      { story: 1, verticalKN: 288, liveLoadKN: 144, lateralXKN: undefined, lateralYKN: undefined },
    ]);
  });

  it('should carry forward frameBaseSupportType from existing state', () => {
    const existing = {
      inferredType: 'frame',
      frameBaseSupportType: 'fixed',
      updatedAt: Date.now(),
    };
    const result = mergeDraftState(existing, {});
    expect(result.frameBaseSupportType).toBe('fixed');
  });

  it('should override frameBaseSupportType from patch', () => {
    const existing = {
      inferredType: 'frame',
      frameBaseSupportType: 'fixed',
      updatedAt: Date.now(),
    };
    const result = mergeDraftState(existing, { frameBaseSupportType: 'pinned' });
    expect(result.frameBaseSupportType).toBe('pinned');
  });
});

// ---------------------------------------------------------------------------
// buildInteractionQuestions
// ---------------------------------------------------------------------------
describe('buildInteractionQuestions', () => {
  const baseDraft = {
    inferredType: 'beam',
    updatedAt: Date.now(),
  };

  it('should produce a question for each missing key', () => {
    const keys = ['lengthM', 'loadKN'];
    const questions = buildInteractionQuestions(keys, keys, baseDraft, 'en');
    expect(questions).toHaveLength(2);
    expect(questions[0].paramKey).toBe('lengthM');
    expect(questions[1].paramKey).toBe('loadKN');
  });

  it('should mark critical keys as critical', () => {
    const questions = buildInteractionQuestions(['lengthM'], ['lengthM'], baseDraft, 'en');
    expect(questions[0].critical).toBe(true);
  });

  it('should mark non-critical keys as not critical', () => {
    const questions = buildInteractionQuestions(['loadType'], [], baseDraft, 'en');
    expect(questions[0].critical).toBe(false);
  });

  it('should produce question for inferredType', () => {
    const questions = buildInteractionQuestions(['inferredType'], ['inferredType'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('inferredType');
    expect(questions[0].question).toContain('structural system');
  });

  it('should produce question for lengthM with unit "m"', () => {
    const questions = buildInteractionQuestions(['lengthM'], ['lengthM'], baseDraft, 'en');
    expect(questions[0].unit).toBe('m');
    expect(questions[0].question).toContain('span');
  });

  it('should produce question for spanLengthM', () => {
    const questions = buildInteractionQuestions(['spanLengthM'], ['spanLengthM'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('spanLengthM');
    expect(questions[0].unit).toBe('m');
  });

  it('should produce question for heightM', () => {
    const questions = buildInteractionQuestions(['heightM'], ['heightM'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('heightM');
    expect(questions[0].unit).toBe('m');
  });

  it('should produce question for supportType with suggestedValue', () => {
    const questions = buildInteractionQuestions(['supportType'], ['supportType'], baseDraft, 'en');
    expect(questions[0].suggestedValue).toBe('simply-supported');
  });

  it('should produce question for frameDimension with suggestedValue', () => {
    const questions = buildInteractionQuestions(['frameDimension'], ['frameDimension'], baseDraft, 'en');
    expect(questions[0].suggestedValue).toBe('2d');
  });

  it('should produce question for storyCount', () => {
    const questions = buildInteractionQuestions(['storyCount'], ['storyCount'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('storyCount');
  });

  it('should produce question for bayCount', () => {
    const questions = buildInteractionQuestions(['bayCount'], ['bayCount'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('bayCount');
  });

  it('should produce question for bayCountX', () => {
    const questions = buildInteractionQuestions(['bayCountX'], ['bayCountX'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('bayCountX');
  });

  it('should produce question for bayCountY', () => {
    const questions = buildInteractionQuestions(['bayCountY'], ['bayCountY'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('bayCountY');
  });

  it('should produce question for storyHeightsM with unit m', () => {
    const questions = buildInteractionQuestions(['storyHeightsM'], ['storyHeightsM'], baseDraft, 'en');
    expect(questions[0].unit).toBe('m');
  });

  it('should produce question for bayWidthsM with unit m', () => {
    const questions = buildInteractionQuestions(['bayWidthsM'], ['bayWidthsM'], baseDraft, 'en');
    expect(questions[0].unit).toBe('m');
  });

  it('should produce question for bayWidthsXM with unit m', () => {
    const questions = buildInteractionQuestions(['bayWidthsXM'], ['bayWidthsXM'], baseDraft, 'en');
    expect(questions[0].unit).toBe('m');
  });

  it('should produce question for bayWidthsYM with unit m', () => {
    const questions = buildInteractionQuestions(['bayWidthsYM'], ['bayWidthsYM'], baseDraft, 'en');
    expect(questions[0].unit).toBe('m');
  });

  it('should produce question for floorLoads with unit kN', () => {
    const questions = buildInteractionQuestions(['floorLoads'], ['floorLoads'], baseDraft, 'en');
    expect(questions[0].unit).toBe('kN');
  });

  it('should produce question for loadKN with unit kN', () => {
    const questions = buildInteractionQuestions(['loadKN'], ['loadKN'], baseDraft, 'en');
    expect(questions[0].unit).toBe('kN');
  });

  it('should produce question for loadType with suggestedValue "point"', () => {
    const questions = buildInteractionQuestions(['loadType'], ['loadType'], baseDraft, 'en');
    expect(questions[0].suggestedValue).toBe('point');
  });

  it('should produce question for loadPosition', () => {
    const questions = buildInteractionQuestions(['loadPosition'], ['loadPosition'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('loadPosition');
  });

  it('should produce fallback question for unknown param key', () => {
    const questions = buildInteractionQuestions(['customField'], ['customField'], baseDraft, 'en');
    expect(questions[0].paramKey).toBe('customField');
    expect(questions[0].label).toBe('customField');
    expect(questions[0].question).toContain('customField');
  });

  it('should localize questions to Chinese', () => {
    const questions = buildInteractionQuestions(['lengthM'], ['lengthM'], baseDraft, 'zh');
    expect(questions[0].question).toMatch(/[\u4e00-\u9fff]/);
  });

  it('should use beam-specific load type question', () => {
    const beamDraft = { ...baseDraft, inferredType: 'beam' };
    const questions = buildInteractionQuestions(['loadType'], ['loadType'], beamDraft, 'en');
    expect(questions[0].question).toContain('point or distributed');
  });

  it('should use portal-frame-specific load type question', () => {
    const portalDraft = { ...baseDraft, inferredType: 'portal-frame' };
    const questions = buildInteractionQuestions(['loadType'], ['loadType'], portalDraft, 'en');
    expect(questions[0].question).toContain('portal-frame');
  });

  it('should use double-span-beam-specific load type question', () => {
    const dsDraft = { ...baseDraft, inferredType: 'double-span-beam' };
    const questions = buildInteractionQuestions(['loadType'], ['loadType'], dsDraft, 'en');
    expect(questions[0].question).toContain('double-span');
  });

  it('should use truss-specific load type question', () => {
    const trussDraft = { ...baseDraft, inferredType: 'truss' };
    const questions = buildInteractionQuestions(['loadType'], ['loadType'], trussDraft, 'en');
    expect(questions[0].question).toContain('truss');
  });

  it('should use beam-specific load position question', () => {
    const beamDraft = { ...baseDraft, inferredType: 'beam' };
    const questions = buildInteractionQuestions(['loadPosition'], ['loadPosition'], beamDraft, 'en');
    expect(questions[0].question).toContain('end / midspan / full span');
  });

  it('should use portal-frame-specific load position question', () => {
    const portalDraft = { ...baseDraft, inferredType: 'portal-frame' };
    const questions = buildInteractionQuestions(['loadPosition'], ['loadPosition'], portalDraft, 'en');
    expect(questions[0].question).toContain('top nodes');
  });

  it('should use double-span-beam-specific load position question', () => {
    const dsDraft = { ...baseDraft, inferredType: 'double-span-beam' };
    const questions = buildInteractionQuestions(['loadPosition'], ['loadPosition'], dsDraft, 'en');
    expect(questions[0].question).toContain('middle joint');
  });

  it('should use truss-specific load position question', () => {
    const trussDraft = { ...baseDraft, inferredType: 'truss' };
    const questions = buildInteractionQuestions(['loadPosition'], ['loadPosition'], trussDraft, 'en');
    expect(questions[0].question).toContain('loaded joint');
  });

  it('should use generic load position question for unknown type', () => {
    const unknownDraft = { ...baseDraft, inferredType: 'unknown' };
    const questions = buildInteractionQuestions(['loadPosition'], ['loadPosition'], unknownDraft, 'en');
    expect(questions[0].question).toContain('load position');
  });

  it('should use generic load type question for unknown type', () => {
    const unknownDraft = { ...baseDraft, inferredType: 'unknown' };
    const questions = buildInteractionQuestions(['loadType'], ['loadType'], unknownDraft, 'en');
    expect(questions[0].question).toContain('point or distributed');
  });

  it('should produce all questions for frame-related missing keys', () => {
    const keys = ['frameDimension', 'storyCount', 'storyHeightsM', 'bayCount', 'bayWidthsM', 'floorLoads'];
    const questions = buildInteractionQuestions(keys, keys, baseDraft, 'en');
    expect(questions).toHaveLength(6);
    for (const q of questions) {
      expect(q.required).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildModel (delegated)
// ---------------------------------------------------------------------------
describe('buildModel', () => {
  it('should return an object from a valid draft state', () => {
    const state = {
      inferredType: 'beam',
      lengthM: 6,
      supportType: 'simply-supported',
      loadKN: 10,
      loadType: 'point',
      loadPosition: 'midspan',
      updatedAt: Date.now(),
    };
    const model = buildModel(state);
    expect(model).toBeDefined();
    expect(typeof model).toBe('object');
  });
});
