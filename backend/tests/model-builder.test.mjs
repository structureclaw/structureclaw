import { describe, it, expect } from '@jest/globals';
import { buildModel } from '../dist/agent-runtime/model-builder.js';

/** Minimal DraftState with required `updatedAt` and the fields under test. */
function makeState(overrides) {
  return { updatedAt: Date.now(), ...overrides };
}

// ---------------------------------------------------------------------------
// 1. Beam (default fallback when inferredType is not a recognised structural type)
// ---------------------------------------------------------------------------
describe('buildModel - beam', () => {
  it('should build a cantilever beam model with point load at midspan by default', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 6,
      loadKN: 10,
    });

    const model = buildModel(state);

    expect(model.schema_version).toBe('2.0.0');
    expect(model.unit_system).toBe('SI');
    expect(model.metadata.inferredType).toBe('beam');
    expect(model.metadata.source).toBe('markdown-skill-draft');
    expect(model.metadata.supportType).toBe('cantilever');

    // Cantilever: left fixed, right free (no restraints)
    expect(model.nodes).toHaveLength(3);
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]);
    expect(model.nodes[1].id).toBe('2');
    expect(model.nodes[2].restraints).toBeUndefined();

    // Load at midspan: node load on point node
    expect(model.nodes[1].x).toBe(3); // 6 / 2
    expect(model.nodes[2].x).toBe(6);

    expect(model.elements).toHaveLength(2);
    expect(model.load_cases[0].loads).toEqual([{ node: '2', fz: -10 }]);
    expect(model.load_combinations).toEqual([{ id: 'ULS', factors: { LC1: 1.0 } }]);
  });

  it('should build a simply-supported beam with point load', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 8,
      loadKN: 20,
      supportType: 'simply-supported',
    });

    const model = buildModel(state);

    // Left: pinned, Right: roller
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, false]);
    expect(model.nodes[2].restraints).toEqual([false, true, true, true, true, false]);

    expect(model.metadata.supportType).toBe('simply-supported');
  });

  it('should build a fixed-fixed beam', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 5,
      loadKN: 15,
      supportType: 'fixed-fixed',
    });

    const model = buildModel(state);

    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]);
    expect(model.nodes[2].restraints).toEqual([true, true, true, true, true, true]);
  });

  it('should build a fixed-pinned beam', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 7,
      loadKN: 12,
      supportType: 'fixed-pinned',
    });

    const model = buildModel(state);

    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]);
    expect(model.nodes[2].restraints).toEqual([true, true, true, true, true, false]);
  });

  it('should apply distributed load across both elements', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 6,
      loadKN: 5,
      loadType: 'distributed',
    });

    const model = buildModel(state);

    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -5, wy: 0 },
      { type: 'distributed', element: '2', wz: -5, wy: 0 },
    ]);
  });

  it('should apply full-span distributed load when loadPosition is full-span', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 6,
      loadKN: 8,
      loadPosition: 'full-span',
    });

    const model = buildModel(state);

    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -8, wy: 0 },
      { type: 'distributed', element: '2', wz: -8, wy: 0 },
    ]);
  });

  it('should place point load at the end node when loadPosition is end', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 6,
      loadKN: 10,
      loadPosition: 'end',
    });

    const model = buildModel(state);

    expect(model.load_cases[0].loads).toEqual([{ node: '3', fz: -10 }]);
  });

  it('should place point load at custom loadPositionM when provided and valid', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 10,
      loadKN: 25,
      loadPositionM: 4,
    });

    const model = buildModel(state);

    expect(model.nodes[1].x).toBe(4);
    expect(model.nodes[2].x).toBe(10);
    expect(model.metadata.loadPositionM).toBe(4);
  });

  it('should default to midspan when loadPositionM is zero', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 10,
      loadKN: 5,
      loadPositionM: 0,
    });

    const model = buildModel(state);

    // 0 is not > 0, so falls back to length / 2
    expect(model.nodes[1].x).toBe(5);
  });

  it('should default to midspan when loadPositionM equals length', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 10,
      loadKN: 5,
      loadPositionM: 10,
    });

    const model = buildModel(state);

    // 10 is not < 10, so falls back to length / 2
    expect(model.nodes[1].x).toBe(5);
  });

  it('should default to midspan when loadPositionM exceeds length', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 10,
      loadKN: 5,
      loadPositionM: 99,
    });

    const model = buildModel(state);

    expect(model.nodes[1].x).toBe(5);
  });

  it('should include correct material and section definitions', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 6,
      loadKN: 10,
    });

    const model = buildModel(state);

    expect(model.materials).toEqual([
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
    ]);
    expect(model.sections).toEqual([
      { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Truss
// ---------------------------------------------------------------------------
describe('buildModel - truss', () => {
  it('should build a two-node truss model with axial load', () => {
    const state = makeState({
      inferredType: 'truss',
      lengthM: 12,
      loadKN: 50,
    });

    const model = buildModel(state);

    expect(model.schema_version).toBe('2.0.0');
    expect(model.metadata.inferredType).toBe('truss');

    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[0]).toEqual({
      id: '1', x: 0, y: 0, z: 0,
      restraints: [true, true, true, true, true, true],
    });
    expect(model.nodes[1]).toEqual({
      id: '2', x: 12, y: 0, z: 0,
      restraints: [false, true, true, true, true, true],
    });

    expect(model.elements).toHaveLength(1);
    expect(model.elements[0]).toEqual({
      id: '1', type: 'truss', nodes: ['1', '2'], material: '1', section: '1',
    });

    expect(model.materials[0].name).toBe('steel');
    expect(model.sections[0].type).toBe('rod');

    expect(model.load_cases[0].loads).toEqual([{ node: '2', fx: 50 }]);
    expect(model.load_combinations).toEqual([{ id: 'ULS', factors: { LC1: 1.0 } }]);
  });
});

// ---------------------------------------------------------------------------
// 3. Portal frame
// ---------------------------------------------------------------------------
describe('buildModel - portal-frame', () => {
  it('should build a portal frame with two columns and a beam', () => {
    const state = makeState({
      inferredType: 'portal-frame',
      spanLengthM: 8,
      heightM: 4,
      loadKN: 20,
    });

    const model = buildModel(state);

    expect(model.schema_version).toBe('2.0.0');
    expect(model.metadata.inferredType).toBe('portal-frame');

    // 4 nodes: base-left, base-right, top-left, top-right
    expect(model.nodes).toHaveLength(4);
    expect(model.nodes[0]).toEqual({ id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] });
    expect(model.nodes[1]).toEqual({ id: '2', x: 8, y: 0, z: 0, restraints: [true, true, true, true, true, true] });
    expect(model.nodes[2]).toEqual({ id: '3', x: 0, y: 0, z: 4 });
    expect(model.nodes[3]).toEqual({ id: '4', x: 8, y: 0, z: 4 });

    // 3 elements: left column, beam, right column
    expect(model.elements).toHaveLength(3);
    expect(model.elements[0]).toEqual({ id: '1', type: 'beam', nodes: ['1', '3'], material: '1', section: '1' });
    expect(model.elements[1]).toEqual({ id: '2', type: 'beam', nodes: ['3', '4'], material: '1', section: '1' });
    expect(model.elements[2]).toEqual({ id: '3', type: 'beam', nodes: ['4', '2'], material: '1', section: '1' });

    // Load split equally between top nodes
    expect(model.load_cases[0].loads).toEqual([
      { type: 'nodal', node: '3', forces: [0, 0, -10, 0, 0, 0] },
      { type: 'nodal', node: '4', forces: [0, 0, -10, 0, 0, 0] },
    ]);

    expect(model.sections[0].name).toBe('PF1');
  });
});

// ---------------------------------------------------------------------------
// 4. Double-span beam
// ---------------------------------------------------------------------------
describe('buildModel - double-span-beam', () => {
  it('should build a continuous two-span beam with point load at middle support', () => {
    const state = makeState({
      inferredType: 'double-span-beam',
      spanLengthM: 5,
      loadKN: 30,
    });

    const model = buildModel(state);

    expect(model.schema_version).toBe('2.0.0');
    expect(model.metadata.inferredType).toBe('double-span-beam');

    expect(model.nodes).toHaveLength(3);
    expect(model.nodes[0]).toEqual({
      id: '1', x: 0, y: 0, z: 0,
      restraints: [true, true, true, true, true, true],
    });
    expect(model.nodes[1]).toEqual({ id: '2', x: 5, y: 0, z: 0 });
    expect(model.nodes[2]).toEqual({
      id: '3', x: 10, y: 0, z: 0,
      restraints: [false, true, true, true, true, true],
    });

    expect(model.elements).toHaveLength(2);
    expect(model.elements[0]).toEqual({ id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' });
    expect(model.elements[1]).toEqual({ id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' });

    expect(model.load_cases[0].loads).toEqual([{ node: '2', fz: -30 }]);
    expect(model.sections[0].name).toBe('B1');
  });
});

// ---------------------------------------------------------------------------
// 5. Frame 2D
// ---------------------------------------------------------------------------
describe('buildModel - frame 2D', () => {
  it('should build a 2D frame with 1 bay and 1 story', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [],
    });

    const model = buildModel(state);

    expect(model.schema_version).toBe('2.0.0');
    expect(model.metadata.inferredType).toBe('frame');
    expect(model.metadata.storyCount).toBe(1);
    expect(model.metadata.bayCount).toBe(1);
    expect(model.metadata.baseSupport).toBe('fixed');

    // 2 x-coords (0, 6), 2 y-coords (0, 4) => 4 nodes
    expect(model.nodes).toHaveLength(4);
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]); // ground node
    expect(model.nodes[1].restraints).toEqual([true, true, true, true, true, true]); // ground node
    expect(model.nodes[2].restraints).toBeUndefined(); // top node
    expect(model.nodes[3].restraints).toBeUndefined(); // top node

    // 2 columns + 1 beam = 3 elements
    expect(model.elements).toHaveLength(3);

    // Columns
    expect(model.elements[0].type).toBe('beam');
    expect(model.elements[0].section).toBe('1'); // COLUMN section
    // Beams
    expect(model.elements[2].section).toBe('2'); // BEAM section

    expect(model.metadata.geometry).toEqual({
      storyHeightsM: [4],
      bayWidthsM: [6],
    });
  });

  it('should build a 2D frame with 2 bays and 2 stories', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [5, 6],
      storyHeightsM: [3, 4],
      floorLoads: [],
    });

    const model = buildModel(state);

    // 3 x-coords, 3 y-coords => 9 nodes
    expect(model.nodes).toHaveLength(9);

    // 3 x-coords * 2 stories = 6 columns
    // 2 bays * 2 stories = 4 beams => total 10 elements
    expect(model.elements).toHaveLength(10);

    expect(model.metadata.storyCount).toBe(2);
    expect(model.metadata.bayCount).toBe(2);
    expect(model.metadata.geometry.storyHeightsM).toEqual([3, 4]);
    expect(model.metadata.geometry.bayWidthsM).toEqual([5, 6]);
  });

  it('should apply floor loads distributed across nodes on a 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, verticalKN: 12, lateralXKN: 6 },
      ],
    });

    const model = buildModel(state);

    // levelNodeCount = 2 nodes at story 1
    // vertical per node = -12 / 2 = -6, lateral per node = 6 / 2 = 3
    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(2);
    expect(loads[0]).toEqual({ node: 'N1_0', fz: -6, fx: 3 });
    expect(loads[1]).toEqual({ node: 'N1_1', fz: -6, fx: 3 });
  });

  it('should skip floor loads for invalid story indices', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [
        { story: 0, verticalKN: 10 },
        { story: 5, verticalKN: 10 },
        { story: -1, verticalKN: 10 },
      ],
    });

    const model = buildModel(state);

    expect(model.load_cases[0].loads).toHaveLength(0);
  });

  it('should handle only vertical load (no lateral) in 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, verticalKN: 10 },
      ],
    });

    const model = buildModel(state);

    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(2);
    for (const load of loads) {
      expect(load.fz).toBe(-5);
      expect(load.fx).toBeUndefined();
    }
  });

  it('should handle only lateral load (no vertical) in 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, lateralXKN: 8 },
      ],
    });

    const model = buildModel(state);

    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(2);
    for (const load of loads) {
      expect(load.fx).toBe(4);
      expect(load.fz).toBeUndefined();
    }
  });

  it('should use pinned base support for 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [],
      frameBaseSupportType: 'pinned',
    });

    const model = buildModel(state);

    expect(model.nodes[0].restraints).toEqual([true, true, true, false, false, false]);
    expect(model.metadata.baseSupport).toBe('pinned');
  });

  it('should include correct materials and sections for 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [4],
      floorLoads: [],
    });

    const model = buildModel(state);

    expect(model.materials).toEqual([
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850, fy: 345 },
    ]);
    expect(model.sections).toHaveLength(2);
    expect(model.sections[0].name).toBe('COLUMN');
    expect(model.sections[1].name).toBe('BEAM');
  });

  it('should generate correct node IDs in 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [4, 3],
      storyHeightsM: [3],
      floorLoads: [],
    });

    const model = buildModel(state);

    // x-coords: 0, 4, 7; y-coords: 0, 3
    // Ground nodes: N0_0, N0_1, N0_2
    // Top nodes: N1_0, N1_1, N1_2
    const nodeIds = model.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(['N0_0', 'N0_1', 'N0_2', 'N1_0', 'N1_1', 'N1_2']);

    // Verify coordinates
    expect(model.nodes[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(model.nodes[1]).toMatchObject({ x: 4, y: 0, z: 0 });
    expect(model.nodes[2]).toMatchObject({ x: 7, y: 0, z: 0 });
    expect(model.nodes[3]).toMatchObject({ x: 0, y: 0, z: 3 });
    expect(model.nodes[4]).toMatchObject({ x: 4, y: 0, z: 3 });
    expect(model.nodes[5]).toMatchObject({ x: 7, y: 0, z: 3 });
  });
});

// ---------------------------------------------------------------------------
// 6. Frame 3D
// ---------------------------------------------------------------------------
describe('buildModel - frame 3D', () => {
  it('should build a 3D frame with 1 bay in each direction and 1 story', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [],
    });

    const model = buildModel(state);

    expect(model.schema_version).toBe('2.0.0');
    expect(model.metadata.inferredType).toBe('frame');
    expect(model.metadata.bayCountX).toBe(1);
    expect(model.metadata.bayCountY).toBe(1);
    expect(model.metadata.baseSupport).toBe('fixed');

    // 2 x-coords, 2 z-coords, 2 y-coords => 8 nodes
    expect(model.nodes).toHaveLength(8);

    // Ground nodes have restraints, top nodes do not
    const groundNodes = model.nodes.filter((n) => n.restraints !== undefined);
    const topNodes = model.nodes.filter((n) => n.restraints === undefined);
    expect(groundNodes).toHaveLength(4);
    expect(topNodes).toHaveLength(4);

    // Columns: 2x * 2z = 4, X-beams: 1 bay * 2z = 2, Y-beams: 2x * 1 bay = 2 => 8
    expect(model.elements).toHaveLength(8);

    expect(model.metadata.geometry).toEqual({
      storyHeightsM: [4],
      bayWidthsXM: [6],
      bayWidthsYM: [5],
    });
  });

  it('should build a 3D frame with 2 bays X and 1 bay Y and 2 stories', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [4, 3],
      bayWidthsYM: [5],
      storyHeightsM: [3, 4],
      floorLoads: [],
    });

    const model = buildModel(state);

    // 3 x-coords, 2 z-coords, 3 y-coords => 18 nodes
    expect(model.nodes).toHaveLength(18);

    // Columns: 3x * 2z * 2 stories = 12
    // X-beams: 2 bays * 2z * 2 stories = 8
    // Y-beams: 3x * 1 bay * 2 stories = 6 => 26 total
    expect(model.elements).toHaveLength(26);
  });

  it('should apply floor loads distributed across 3D frame nodes', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, verticalKN: 20, lateralXKN: 10, lateralYKN: 8 },
      ],
    });

    const model = buildModel(state);

    // levelNodeCount = 2 x 2 = 4
    // vertical per node = -20/4 = -5, lateralX = 10/4 = 2.5, lateralY = 8/4 = 2
    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(4);
    for (const load of loads) {
      expect(load.fz).toBe(-5);
      expect(load.fx).toBe(2.5);
      expect(load.fy).toBe(2);
    }
  });

  it('should skip invalid story indices in 3D frame loads', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [
        { story: 0, verticalKN: 20 },
        { story: 2, verticalKN: 20 },
      ],
    });

    const model = buildModel(state);

    expect(model.load_cases[0].loads).toHaveLength(0);
  });

  it('should use pinned base support for 3D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [],
      frameBaseSupportType: 'pinned',
    });

    const model = buildModel(state);

    const groundNodes = model.nodes.filter((n) => n.restraints !== undefined);
    for (const node of groundNodes) {
      expect(node.restraints).toEqual([true, true, true, false, false, false]);
    }
    expect(model.metadata.baseSupport).toBe('pinned');
  });

  it('should generate correct 3D node IDs', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [],
    });

    const model = buildModel(state);

    const nodeIds = model.nodes.map((n) => n.id);
    // Ground floor (story 0): N0_0_0, N0_1_0, N0_0_1, N0_1_1
    // Top floor (story 1): N1_0_0, N1_1_0, N1_0_1, N1_1_1
    expect(nodeIds).toContain('N0_0_0');
    expect(nodeIds).toContain('N0_1_0');
    expect(nodeIds).toContain('N0_0_1');
    expect(nodeIds).toContain('N0_1_1');
    expect(nodeIds).toContain('N1_0_0');
    expect(nodeIds).toContain('N1_1_0');
    expect(nodeIds).toContain('N1_0_1');
    expect(nodeIds).toContain('N1_1_1');
  });

  it('should include correct materials and sections for 3D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [],
    });

    const model = buildModel(state);

    expect(model.materials[0]).toEqual({ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850, fy: 345 });
    expect(model.sections[0].name).toBe('COLUMN');
    expect(model.sections[1].name).toBe('BEAM');
  });
});

// ---------------------------------------------------------------------------
// 7. Unknown / fallback type (treated as beam)
// ---------------------------------------------------------------------------
describe('buildModel - unknown type falls back to beam', () => {
  it('should treat unknown inferredType as a cantilever beam', () => {
    const state = makeState({
      inferredType: 'unknown',
      lengthM: 4,
      loadKN: 8,
    });

    const model = buildModel(state);

    // Falls through all if-checks to the default beam builder
    expect(model.metadata.inferredType).toBe('unknown');
    expect(model.metadata.supportType).toBe('cantilever');
    expect(model.nodes).toHaveLength(3);
    expect(model.load_cases[0].loads).toEqual([{ node: '2', fz: -8 }]);
  });

  it('should treat an unmapped type as beam', () => {
    const state = makeState({
      inferredType: 'girder',
      lengthM: 10,
      loadKN: 20,
      supportType: 'simply-supported',
    });

    const model = buildModel(state);

    expect(model.metadata.inferredType).toBe('girder');
    expect(model.metadata.supportType).toBe('simply-supported');
    expect(model.nodes).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 8. Edge cases: missing fields, partial data
// ---------------------------------------------------------------------------
describe('buildModel - edge cases', () => {
  it('should handle beam with undefined loadType and undefined loadPosition (defaults to point at midspan)', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 8,
      loadKN: 15,
      loadType: undefined,
      loadPosition: undefined,
    });

    const model = buildModel(state);

    // Neither distributed nor full-span, so point load on pointNodeId ('2')
    expect(model.load_cases[0].loads).toEqual([{ node: '2', fz: -15 }]);
    expect(model.nodes[1].x).toBe(4);
  });

  it('should default supportType to cantilever when not provided', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 6,
      loadKN: 10,
    });

    const model = buildModel(state);

    expect(model.metadata.supportType).toBe('cantilever');
    // Cantilever: left fixed, right has no restraints
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]);
  });

  it('should handle beam with negative loadPositionM (defaults to midspan)', () => {
    const state = makeState({
      inferredType: 'beam',
      lengthM: 8,
      loadKN: 10,
      loadPositionM: -3,
    });

    const model = buildModel(state);

    // -3 is not > 0, so falls back to 8/2 = 4
    expect(model.nodes[1].x).toBe(4);
  });

  it('should handle frame 2D with no floorLoads (empty loads)', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [3],
      floorLoads: [],
    });

    const model = buildModel(state);

    expect(model.load_cases[0].loads).toEqual([]);
  });

  it('should handle frame 2D with undefined frameBaseSupportType (defaults to fixed)', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [3],
      floorLoads: [],
    });

    const model = buildModel(state);

    expect(model.metadata.baseSupport).toBe('fixed');
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]);
  });

  it('should handle frame 3D with only vertical floor load', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, verticalKN: 12 },
      ],
    });

    const model = buildModel(state);

    // 4 nodes at level, -12/4 = -3 each
    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(4);
    for (const load of loads) {
      expect(load.fz).toBe(-3);
      expect(load.fx).toBeUndefined();
      expect(load.fy).toBeUndefined();
    }
  });

  it('should handle frame 3D with only lateralX floor load', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, lateralXKN: 8 },
      ],
    });

    const model = buildModel(state);

    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(4);
    for (const load of loads) {
      expect(load.fx).toBe(2);
      expect(load.fy).toBeUndefined();
      expect(load.fz).toBeUndefined();
    }
  });

  it('should handle frame 3D with only lateralY floor load', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [
        { story: 1, lateralYKN: 12 },
      ],
    });

    const model = buildModel(state);

    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(4);
    for (const load of loads) {
      expect(load.fy).toBe(3);
      expect(load.fz).toBeUndefined();
      expect(load.fx).toBeUndefined();
    }
  });

  it('should handle floor load with no relevant force values (skipped)', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [3],
      floorLoads: [
        { story: 1 },
      ],
    });

    const model = buildModel(state);

    // No vertical, no lateralX => nodeLoad only has 'node' key, length <= 1 so skipped
    expect(model.load_cases[0].loads).toHaveLength(0);
  });

  it('should handle multiple floor loads on different stories in 2D frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [3, 4],
      floorLoads: [
        { story: 1, verticalKN: 10 },
        { story: 2, verticalKN: 20 },
      ],
    });

    const model = buildModel(state);

    // Story 1: 2 nodes, -10/2 = -5 each
    // Story 2: 2 nodes, -20/2 = -10 each
    const loads = model.load_cases[0].loads;
    expect(loads).toHaveLength(4);

    const story1Loads = loads.filter((l) => l.node.startsWith('N1_'));
    const story2Loads = loads.filter((l) => l.node.startsWith('N2_'));
    expect(story1Loads).toHaveLength(2);
    expect(story2Loads).toHaveLength(2);
    expect(story1Loads[0].fz).toBe(-5);
    expect(story2Loads[0].fz).toBe(-10);
  });

  it('should correctly compute node coordinates for multi-bay frame', () => {
    const state = makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [3, 4, 2],
      storyHeightsM: [3.5],
      floorLoads: [],
    });

    const model = buildModel(state);

    // x-coordinates: 0, 3, 7, 9
    const groundXCoords = model.nodes
      .filter((n) => n.id.startsWith('N0_'))
      .map((n) => n.x);
    expect(groundXCoords).toEqual([0, 3, 7, 9]);
  });
});

// ---------------------------------------------------------------------------
// 9. Coordinate semantics migration anchors (z-up target)
// ---------------------------------------------------------------------------
describe('buildModel - coordinate semantics (z-up migration)', () => {
  it('should build 2d frame coordinates on the xz plane', () => {
    const model = buildModel(makeState({
      inferredType: 'frame',
      frameDimension: '2d',
      bayWidthsM: [6],
      storyHeightsM: [3],
      floorLoads: [{ story: 1, verticalKN: 12, lateralXKN: 6 }],
    }));

    expect(model.nodes[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(model.nodes[2]).toMatchObject({ x: 0, y: 0, z: 3 });
    expect(model.load_cases[0].loads[0]).toMatchObject({ fx: 3, fz: -6 });
    expect(model.metadata.coordinateSemantics).toBe('global-z-up');
  });

  it('should build 3d frame coordinates with y horizontal and z vertical', () => {
    const model = buildModel(makeState({
      inferredType: 'frame',
      frameDimension: '3d',
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      storyHeightsM: [4],
      floorLoads: [{ story: 1, verticalKN: 20, lateralXKN: 10, lateralYKN: 8 }],
    }));

    expect(model.nodes).toContainEqual(expect.objectContaining({ id: 'N1_0_0', x: 0, y: 0, z: 4 }));
    expect(model.nodes).toContainEqual(expect.objectContaining({ id: 'N1_0_1', x: 0, y: 5, z: 4 }));
    expect(model.load_cases[0].loads[0]).toMatchObject({ fx: 2.5, fy: 2, fz: -5 });
    expect(model.metadata.elementReferenceVectors.BX5).toEqual([0, 0, 1]);
  });
});
