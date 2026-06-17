import {
  STRUCTURAL_COORDINATE_SEMANTICS,
} from './coordinate-semantics.js';
import { buildElementReferenceVectors } from './reference-vectors.js';
import type {
  DraftLoadPosition,
  DraftLoadType,
  DraftState,
  DraftSupportType,
  FrameBaseSupportType,
} from './types.js';

function buildFixedRestraint(baseSupport: FrameBaseSupportType): boolean[] {
  if (baseSupport === 'pinned') {
    return [true, true, true, false, false, false];
  }
  return [true, true, true, true, true, true];
}

function accumulateCoordinates(lengths: number[]): number[] {
  const coordinates = [0];
  for (const value of lengths) {
    coordinates.push(coordinates[coordinates.length - 1] + value);
  }
  return coordinates;
}

function get2dNodeId(storyIndex: number, bayNodeIndex: number): string {
  return `N${storyIndex}_${bayNodeIndex}`;
}

function get3dNodeId(storyIndex: number, xIndex: number, yIndex: number): string {
  return `N${storyIndex}_${xIndex}_${yIndex}`;
}

function buildFrame2dModel(state: DraftState, metadata: Record<string, unknown>): Record<string, unknown> {
  const bayWidths = state.bayWidthsM!;
  const storyHeights = state.storyHeightsM!;
  const floorLoads = state.floorLoads!;
  const xCoordinates = accumulateCoordinates(bayWidths);
  const zCoordinates = accumulateCoordinates(storyHeights);
  const baseSupport = state.frameBaseSupportType || 'fixed';
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loadCases = [{ id: 'LC1', type: 'other', loads: [] as Array<Record<string, unknown>> }];
  let elementId = 1;

  for (let storyIndex = 0; storyIndex < zCoordinates.length; storyIndex += 1) {
    for (let bayNodeIndex = 0; bayNodeIndex < xCoordinates.length; bayNodeIndex += 1) {
      const node: Record<string, unknown> = {
        id: get2dNodeId(storyIndex, bayNodeIndex),
        x: xCoordinates[bayNodeIndex],
        y: 0,
        z: zCoordinates[storyIndex],
      };
      if (storyIndex === 0) {
        node.restraints = buildFixedRestraint(baseSupport);
      }
      nodes.push(node);
    }
  }

  for (let storyIndex = 1; storyIndex < zCoordinates.length; storyIndex += 1) {
    for (let bayNodeIndex = 0; bayNodeIndex < xCoordinates.length; bayNodeIndex += 1) {
      elements.push({
        id: `C${elementId}`,
        type: 'beam',
        nodes: [get2dNodeId(storyIndex - 1, bayNodeIndex), get2dNodeId(storyIndex, bayNodeIndex)],
        material: '1',
        section: '1',
      });
      elementId += 1;
    }
  }

  for (let storyIndex = 1; storyIndex < zCoordinates.length; storyIndex += 1) {
    for (let bayIndex = 0; bayIndex < bayWidths.length; bayIndex += 1) {
      elements.push({
        id: `B${elementId}`,
        type: 'beam',
        nodes: [get2dNodeId(storyIndex, bayIndex), get2dNodeId(storyIndex, bayIndex + 1)],
        material: '1',
        section: '2',
      });
      elementId += 1;
    }
  }

  const levelNodeCount = xCoordinates.length;
  for (const load of floorLoads) {
    const storyIndex = load.story;
    if (storyIndex <= 0 || storyIndex >= zCoordinates.length) {
      continue;
    }
    const verticalPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lateralPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    for (let bayNodeIndex = 0; bayNodeIndex < xCoordinates.length; bayNodeIndex += 1) {
      const nodeLoad: Record<string, unknown> = { node: get2dNodeId(storyIndex, bayNodeIndex) };
      if (verticalPerNode !== undefined) {
        nodeLoad.fz = verticalPerNode;
      }
      if (lateralPerNode !== undefined) {
        nodeLoad.fx = lateralPerNode;
      }
      if (Object.keys(nodeLoad).length > 1) {
        loadCases[0].loads.push(nodeLoad);
      }
    }
  }

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850, fy: 345 }],
    sections: [
      { id: '1', name: 'COLUMN', type: 'beam', properties: { A: 0.03, Iy: 0.00035, Iz: 0.00035, J: 0.00015, G: 79000 } },
      { id: '2', name: 'BEAM', type: 'beam', properties: { A: 0.02, Iy: 0.00022, Iz: 0.00022, J: 0.0001, G: 79000 } },
    ],
    load_cases: loadCases,
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      baseSupport,
      storyCount: storyHeights.length,
      bayCount: bayWidths.length,
      geometry: {
        storyHeightsM: storyHeights,
        bayWidthsM: bayWidths,
      },
    },
  };
}

function buildFrame3dModel(state: DraftState, metadata: Record<string, unknown>): Record<string, unknown> {
  const bayWidthsX = state.bayWidthsXM!;
  const bayWidthsY = state.bayWidthsYM!;
  const storyHeights = state.storyHeightsM!;
  const floorLoads = state.floorLoads!;
  const xCoordinates = accumulateCoordinates(bayWidthsX);
  const yCoordinates = accumulateCoordinates(bayWidthsY);
  const zCoordinates = accumulateCoordinates(storyHeights);
  const baseSupport = state.frameBaseSupportType || 'fixed';
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loadCases = [{ id: 'LC1', type: 'other', loads: [] as Array<Record<string, unknown>> }];
  let elementId = 1;

  for (let storyIndex = 0; storyIndex < zCoordinates.length; storyIndex += 1) {
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < yCoordinates.length; yIndex += 1) {
        const node: Record<string, unknown> = {
          id: get3dNodeId(storyIndex, xIndex, yIndex),
          x: xCoordinates[xIndex],
          y: yCoordinates[yIndex],
          z: zCoordinates[storyIndex],
        };
        if (storyIndex === 0) {
          node.restraints = buildFixedRestraint(baseSupport);
        }
        nodes.push(node);
      }
    }
  }

  for (let storyIndex = 1; storyIndex < zCoordinates.length; storyIndex += 1) {
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < yCoordinates.length; yIndex += 1) {
        elements.push({
          id: `C${elementId}`,
          type: 'beam',
          nodes: [get3dNodeId(storyIndex - 1, xIndex, yIndex), get3dNodeId(storyIndex, xIndex, yIndex)],
          material: '1',
          section: '1',
        });
        elementId += 1;
      }
    }
  }

  for (let storyIndex = 1; storyIndex < zCoordinates.length; storyIndex += 1) {
    for (let xIndex = 0; xIndex < bayWidthsX.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < yCoordinates.length; yIndex += 1) {
        elements.push({
          id: `BX${elementId}`,
          type: 'beam',
          nodes: [get3dNodeId(storyIndex, xIndex, yIndex), get3dNodeId(storyIndex, xIndex + 1, yIndex)],
          material: '1',
          section: '2',
        });
        elementId += 1;
      }
    }
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < bayWidthsY.length; yIndex += 1) {
        elements.push({
          id: `BY${elementId}`,
          type: 'beam',
          nodes: [get3dNodeId(storyIndex, xIndex, yIndex), get3dNodeId(storyIndex, xIndex, yIndex + 1)],
          material: '1',
          section: '2',
        });
        elementId += 1;
      }
    }
  }

  const levelNodeCount = xCoordinates.length * yCoordinates.length;
  for (const load of floorLoads) {
    const storyIndex = load.story;
    if (storyIndex <= 0 || storyIndex >= zCoordinates.length) {
      continue;
    }
    const verticalPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lateralXPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    const lateralYPerNode = load.lateralYKN !== undefined ? load.lateralYKN / levelNodeCount : undefined;
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < yCoordinates.length; yIndex += 1) {
        const nodeLoad: Record<string, unknown> = { node: get3dNodeId(storyIndex, xIndex, yIndex) };
        if (verticalPerNode !== undefined) {
          nodeLoad.fz = verticalPerNode;
        }
        if (lateralXPerNode !== undefined) {
          nodeLoad.fx = lateralXPerNode;
        }
        if (lateralYPerNode !== undefined) {
          nodeLoad.fy = lateralYPerNode;
        }
        if (Object.keys(nodeLoad).length > 1) {
          loadCases[0].loads.push(nodeLoad);
        }
      }
    }
  }

  const elementReferenceVectors = buildElementReferenceVectors(elements, nodes);

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850, fy: 345 }],
    sections: [
      { id: '1', name: 'COLUMN', type: 'beam', properties: { A: 0.035, Iy: 0.0004, Iz: 0.0004, J: 0.00018, G: 79000 } },
      { id: '2', name: 'BEAM', type: 'beam', properties: { A: 0.025, Iy: 0.00025, Iz: 0.00025, J: 0.00012, G: 79000 } },
    ],
    load_cases: loadCases,
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      elementReferenceVectors,
      baseSupport,
      storyCount: storyHeights.length,
      bayCountX: bayWidthsX.length,
      bayCountY: bayWidthsY.length,
      geometry: {
        storyHeightsM: storyHeights,
        bayWidthsXM: bayWidthsX,
        bayWidthsYM: bayWidthsY,
      },
    },
  };
}

function buildBeamNodes(length: number, supportType: DraftSupportType, loadPositionM?: number) {
  const fixedRestraint = [true, true, true, true, true, true] as const;
  const pinnedRestraint = [true, true, true, true, true, false] as const;
  const rollerRestraint = [false, true, true, true, true, false] as const;
  let leftRestraint: boolean[] = [...fixedRestraint];
  let rightRestraint: boolean[] | undefined;

  if (supportType === 'simply-supported') {
    leftRestraint = [...pinnedRestraint];
    rightRestraint = [...rollerRestraint];
  } else if (supportType === 'fixed-fixed') {
    rightRestraint = [...fixedRestraint];
  } else if (supportType === 'fixed-pinned') {
    rightRestraint = [...pinnedRestraint];
  }

  const position = typeof loadPositionM === 'number' && loadPositionM > 0 && loadPositionM < length
    ? loadPositionM
    : length / 2;

  return {
    nodes: [
      { id: '1', x: 0, y: 0, z: 0, restraints: leftRestraint },
      { id: '2', x: position, y: 0, z: 0 },
      rightRestraint
        ? { id: '3', x: length, y: 0, z: 0, restraints: rightRestraint }
        : { id: '3', x: length, y: 0, z: 0 },
    ],
    elements: [
      { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
      { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
    ],
    pointNodeId: '2',
    endNodeId: '3',
  };
}

function buildBeamLoads(
  loadKN: number,
  loadType: DraftLoadType | undefined,
  loadPosition: DraftLoadPosition | undefined,
  pointNodeId: string,
  endNodeId: string,
) {
  if (loadType === 'distributed' || loadPosition === 'full-span') {
    return [
      { type: 'distributed', element: '1', wz: -loadKN, wy: 0 },
      { type: 'distributed', element: '2', wz: -loadKN, wy: 0 },
    ];
  }

  const targetNodeId = loadPosition === 'end' ? endNodeId : pointNodeId;
  return [{ node: targetNodeId, fz: -loadKN }];
}

function getTrussTopology(state: DraftState): string {
  const topology = state.skillState?.trussTopology;
  return typeof topology === 'string' ? topology : 'generic';
}

function getTrussLoadChord(state: DraftState): 'top' | 'bottom' {
  return state.skillState?.trussLoadChord === 'bottom' ? 'bottom' : 'top';
}

function clampTrussPanelCount(value: number | undefined, span: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Math.max(2, Math.min(30, Math.round(span / 3)));
  }
  return Math.max(2, Math.min(30, Math.round(value)));
}

function buildTrussTopElevation(topology: string, x: number, span: number, height: number): number {
  if (topology === 'trapezoidal') {
    return Math.max(height - Math.abs(x - span / 2) * 0.1, height * 0.4);
  }
  return height;
}

function buildTrussModel(state: DraftState, metadata: Record<string, unknown>): Record<string, unknown> {
  const span = state.lengthM!;
  const panelCount = clampTrussPanelCount(state.bayCount, span);
  const height = state.heightM ?? span / 6;
  const load = state.loadKN!;
  const topology = getTrussTopology(state);
  const panelLength = span / panelCount;
  const fixed = [true, true, true, true, true, true];
  const roller = [false, true, true, true, true, true];
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];

  for (let i = 0; i <= panelCount; i += 1) {
    const node: Record<string, unknown> = {
      id: `B${i}`,
      x: i * panelLength,
      y: 0,
      z: 0,
    };
    if (i === 0) {
      node.restraints = fixed;
    } else if (i === panelCount) {
      node.restraints = roller;
    }
    nodes.push(node);
  }

  for (let i = 0; i <= panelCount; i += 1) {
    const x = i * panelLength;
    nodes.push({
      id: `T${i}`,
      x,
      y: 0,
      z: buildTrussTopElevation(topology, x, span, height),
    });
  }

  for (let i = 0; i < panelCount; i += 1) {
    elements.push({
      id: `BC${i}`,
      type: 'truss',
      nodes: [`B${i}`, `B${i + 1}`],
      material: '1',
      section: '1',
    });
    elements.push({
      id: `TC${i}`,
      type: 'truss',
      nodes: [`T${i}`, `T${i + 1}`],
      material: '1',
      section: '1',
    });
  }

  for (let i = 0; i <= panelCount; i += 1) {
    elements.push({
      id: `WV${i}`,
      type: 'truss',
      nodes: [`B${i}`, `T${i}`],
      material: '1',
      section: '1',
    });
    if (i < panelCount) {
      const diagonalNodes = i < panelCount / 2
        ? [`B${i}`, `T${i + 1}`]
        : [`B${i + 1}`, `T${i}`];
      elements.push({
        id: `WD${i}`,
        type: 'truss',
        nodes: diagonalNodes,
        material: '1',
        section: '1',
      });
    }
  }

  const loadChord = getTrussLoadChord(state);
  const loadPrefix = loadChord === 'bottom' ? 'B' : 'T';
  const loadNodeIndexes = state.loadPosition === 'middle-joint'
    ? [Math.max(1, Math.min(panelCount - 1, Math.round(panelCount / 2)))]
    : Array.from({ length: Math.max(0, panelCount - 1) }, (_, index) => index + 1);
  const nodalLoads = loadNodeIndexes.map((index) => ({ node: `${loadPrefix}${index}`, fz: -load }));

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850, fy: 345 },
    ],
    sections: [
      { id: '1', name: 'TRUSS_ROD', type: 'rod', properties: { A: 0.01 } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads: nodalLoads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      trussTopology: topology,
      loadChord,
      panelCount,
      panelCountDefaulted: state.bayCount === undefined,
      heightDefaulted: state.heightM === undefined,
      geometry: {
        spanM: span,
        heightM: height,
        panelLengthM: panelLength,
      },
    },
  };
}

export function buildModel(state: DraftState): Record<string, unknown> {
  const metadata = {
    source: 'markdown-skill-draft',
    inferredType: state.inferredType,
    frameDimension: state.frameDimension === '3d' ? '3d' : '2d',
  };
  if (state.inferredType === 'frame') {
    if (state.frameDimension === '3d') {
      return buildFrame3dModel(state, metadata);
    }
    return buildFrame2dModel(state, metadata);
  }
  if (state.inferredType === 'truss') {
    return buildTrussModel(state, metadata);
  }
  if (state.inferredType === 'double-span-beam') {
    const span = state.spanLengthM!;
    const load = state.loadKN!;
    return {
      schema_version: '2.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: span, y: 0, z: 0 },
        { id: '3', x: span * 2, y: 0, z: 0, restraints: [false, true, true, true, true, true] },
      ],
      elements: [
        { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
        { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [{ node: '2', fz: -load }] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  if (state.inferredType === 'portal-frame') {
    const span = state.spanLengthM!;
    const height = state.heightM!;
    const load = state.loadKN!;
    return {
      schema_version: '2.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: span, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '3', x: 0, y: 0, z: height },
        { id: '4', x: span, y: 0, z: height },
      ],
      elements: [
        { id: '1', type: 'beam', nodes: ['1', '3'], material: '1', section: '1' },
        { id: '2', type: 'beam', nodes: ['3', '4'], material: '1', section: '1' },
        { id: '3', type: 'beam', nodes: ['4', '2'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'PF1', type: 'beam', properties: { A: 0.02, Iy: 0.0002, Iz: 0.0002, J: 0.0002, G: 79000 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [
          { type: 'nodal', node: '3', forces: [0, 0, -load / 2, 0, 0, 0] },
          { type: 'nodal', node: '4', forces: [0, 0, -load / 2, 0, 0, 0] },
        ] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  const length = state.lengthM!;
  const load = state.loadKN!;
  const supportType = state.supportType || 'cantilever';
  const beamNodes = buildBeamNodes(length, supportType, state.loadPositionM);
  const beamLoads = buildBeamLoads(load, state.loadType, state.loadPosition, beamNodes.pointNodeId, beamNodes.endNodeId);
  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes: beamNodes.nodes,
    elements: beamNodes.elements,
    materials: [
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
    ],
    sections: [
      { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads: beamLoads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: { ...metadata, supportType, loadPositionM: state.loadPositionM },
  };
}
