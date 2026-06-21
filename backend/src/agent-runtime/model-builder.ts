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

function buildOverhangingBeamNodes(simpleSpan: number, overhangLength: number) {
  const pinnedRestraint = [true, true, true, true, true, false] as const;
  const rollerRestraint = [false, true, true, true, true, false] as const;
  const totalLength = simpleSpan + overhangLength;

  return {
    nodes: [
      { id: '1', x: 0, y: 0, z: 0, restraints: [...pinnedRestraint] },
      { id: '2', x: simpleSpan, y: 0, z: 0, restraints: [...rollerRestraint] },
      { id: '3', x: totalLength, y: 0, z: 0 },
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

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPositiveNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0);
  return values.length > 0 ? values : undefined;
}

function readNonNegativeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0);
  return values.length > 0 ? values : undefined;
}

function addCoordinate(coordinates: Set<number>, value: number | undefined, length: number): void {
  if (value === undefined || value <= 0 || value >= length) {
    return;
  }
  coordinates.add(Number(value.toFixed(9)));
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(9));
}

function coordinateMatches(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  return records.length ? records : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = readPositiveNumber(value);
  return parsed === undefined ? undefined : Math.max(1, Math.round(parsed));
}

function isSemanticDistributedLoad(load: Record<string, unknown>): boolean {
  return load.kind === 'distributed' || load.kind === 'line' || load.unit === 'kN/m';
}

function isSemanticPointLoad(load: Record<string, unknown>): boolean {
  return load.kind === 'point' || load.kind === 'nodal' || load.unit === 'kN';
}

function semanticPointLoadX(load: Record<string, unknown>, state: DraftState, length: number): number {
  const location = load.location && typeof load.location === 'object' && !Array.isArray(load.location)
    ? load.location as Record<string, unknown>
    : undefined;
  const explicitX = readPositiveNumber(load.xM) ?? readPositiveNumber(location?.xM);
  if (explicitX !== undefined) return explicitX;
  const target = typeof load.target === 'string' ? load.target.toLowerCase() : '';
  if (target.includes('end') || target.includes('free') || target.includes('端')) return length;
  return state.loadPositionM ?? length / 2;
}

function beamSupportCoordinates(state: DraftState, supportType: DraftSupportType, length: number): number[] {
  const explicit = readNonNegativeNumberArray(state.engineeringDraft?.boundary?.supportPositionsM)
    ?.map(roundCoordinate)
    .filter((x) => x >= 0 && x <= length);

  if (explicit?.length) {
    return Array.from(new Set(explicit)).sort((left, right) => left - right);
  }

  if (supportType === 'cantilever') {
    return [0];
  }
  return [0, length];
}

function beamSupportRestraint(supportType: DraftSupportType, supportIndex: number): boolean[] | undefined {
  const fixed = [true, true, true, true, true, true];
  const pinned = [true, true, true, true, true, false];
  const roller = [false, true, true, true, true, false];

  if (supportType === 'cantilever') {
    return supportIndex === 0 ? fixed : undefined;
  }
  if (supportType === 'fixed-fixed') {
    return fixed;
  }
  if (supportType === 'fixed-pinned') {
    return supportIndex === 0 ? fixed : pinned;
  }
  return supportIndex === 0 ? pinned : roller;
}

function buildSemanticBeamModel(
  state: DraftState,
  metadata: Record<string, unknown>,
  semanticLoads: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const length = state.lengthM!;
  const supportType = state.supportType || 'cantilever';
  const hasDistributedLoad = semanticLoads.some(isSemanticDistributedLoad);
  const spanLengths = readPositiveNumberArray(state.engineeringDraft?.geometry?.spanLengthsM);
  const spanBreaks: number[] = [];
  let runningSpan = 0;
  for (const spanLength of spanLengths ?? []) {
    runningSpan += spanLength;
    if (runningSpan > 0 && runningSpan < length) {
      spanBreaks.push(roundCoordinate(runningSpan));
    }
  }
  const pointLoadXs = semanticLoads
    .filter(isSemanticPointLoad)
    .map((load) => semanticPointLoadX(load, state, length));
  const coordinateSet = new Set<number>([0, length]);
  const supportXs = beamSupportCoordinates(state, supportType, length);
  if (hasDistributedLoad) {
    addCoordinate(coordinateSet, length / 2, length);
  }
  for (const x of pointLoadXs) {
    addCoordinate(coordinateSet, x, length);
  }
  for (const x of spanBreaks) {
    addCoordinate(coordinateSet, x, length);
  }
  for (const x of supportXs) {
    if (x === 0 || x === length) {
      coordinateSet.add(x);
    } else {
      addCoordinate(coordinateSet, x, length);
    }
  }
  const coordinates = Array.from(coordinateSet).sort((left, right) => left - right);
  const nodes = coordinates.map((x, index) => {
    const node: Record<string, unknown> = { id: `${index + 1}`, x, y: 0, z: 0 };
    const supportIndex = supportXs.findIndex((supportX) => coordinateMatches(supportX, x));
    const restraints = supportIndex >= 0 ? beamSupportRestraint(supportType, supportIndex) : undefined;
    if (restraints) {
      node.restraints = restraints;
    }
    return node;
  });
  const elements = coordinates.slice(0, -1).map((_x, index) => ({
    id: `${index + 1}`,
    type: 'beam',
    nodes: [`${index + 1}`, `${index + 2}`],
    material: '1',
    section: '1',
  }));
  const loads: Array<Record<string, unknown>> = [];
  for (const load of semanticLoads) {
    const magnitude = readPositiveNumber(load.magnitude);
    if (magnitude === undefined) continue;
    if (isSemanticDistributedLoad(load)) {
      for (const element of elements) {
        loads.push({ type: 'distributed', element: element.id, wz: -magnitude, wy: 0 });
      }
      continue;
    }
    if (isSemanticPointLoad(load)) {
      const x = semanticPointLoadX(load, state, length);
      const nodeIndex = coordinates.findIndex((coordinate) => coordinateMatches(coordinate, x));
      const targetNode = nodeIndex >= 0 ? `${nodeIndex + 1}` : `${Math.max(1, Math.round(coordinates.length / 2))}`;
      const direction = typeof load.direction === 'string' ? load.direction : undefined;
      if (direction === 'globalX') {
        loads.push({ node: targetNode, fx: magnitude });
      } else if (direction === 'globalY') {
        loads.push({ node: targetNode, fy: magnitude });
      } else {
        loads.push({ node: targetNode, fz: -magnitude });
      }
    }
  }

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
    ],
    sections: [
      { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: { ...metadata, supportType, semanticLoadCount: semanticLoads.length },
  };
}

function buildColumnModel(state: DraftState, metadata: Record<string, unknown>): Record<string, unknown> {
  const height = state.heightM ?? state.lengthM!;
  const axialLoad = state.loadKN!;
  const materialFamily = state.skillState?.materialFamily === 'concrete' ? 'concrete' : 'steel';
  const sectionWidthM = readPositiveNumber(state.skillState?.sectionWidthM) ?? 0.4;
  const sectionDepthM = readPositiveNumber(state.skillState?.sectionDepthM) ?? sectionWidthM;
  const area = sectionWidthM * sectionDepthM;
  const iy = (sectionWidthM * (sectionDepthM ** 3)) / 12;
  const iz = (sectionDepthM * (sectionWidthM ** 3)) / 12;
  const elasticModulus = materialFamily === 'concrete' ? 30000 : 205000;
  const shearModulus = materialFamily === 'concrete' ? 12500 : 79000;
  const semanticColumnLoads = readRecordArray(state.skillState?.columnLoads);
  const modelLoads = semanticColumnLoads?.map((load) => {
    const fx = readFiniteNumber(load.fxKN);
    const fy = readFiniteNumber(load.fyKN);
    const fz = readFiniteNumber(load.fzKN);
    return {
      node: '2',
      ...(fx !== undefined && { fx }),
      ...(fy !== undefined && { fy }),
      ...(fz !== undefined && { fz }),
    };
  }).filter((load) => Object.keys(load).length > 1);
  const loads = modelLoads?.length ? modelLoads : [{ node: '2', fz: -axialLoad }];

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes: [
      { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
      { id: '2', x: 0, y: 0, z: height },
    ],
    elements: [
      { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
    ],
    materials: [
      { id: '1', name: materialFamily, E: elasticModulus, nu: 0.2, rho: materialFamily === 'concrete' ? 2500 : 7850 },
    ],
    sections: [
      { id: '1', name: 'COLUMN', type: 'beam', properties: { A: area, Iy: iy, Iz: iz, J: Math.max(iy, iz), G: shearModulus } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      materialFamily,
      geometry: {
        heightM: height,
        sectionWidthM,
        sectionDepthM,
      },
    },
  };
}

function getContinuousBeamSpanLengths(state: DraftState): number[] {
  const explicit = readPositiveNumberArray(state.skillState?.spanLengthsM);
  if (explicit?.length) {
    return explicit;
  }
  const span = state.spanLengthM!;
  const spanCount = Math.max(2, readPositiveInteger(state.skillState?.spanCount) ?? 2);
  return Array.from({ length: spanCount }, () => span);
}

function buildContinuousBeamModel(state: DraftState, metadata: Record<string, unknown>): Record<string, unknown> {
  const spans = getContinuousBeamSpanLengths(state);
  const supportCoordinates = accumulateCoordinates(spans);
  const explicitPointLoad = readPositiveNumber(state.skillState?.pointLoadKN);
  const pointLoad = explicitPointLoad
    ?? (state.loadType === 'point' || state.loadType === undefined ? state.loadKN : undefined);
  const pointSpanIndex = Math.min(
    spans.length - 1,
    Math.max(
      0,
      (readPositiveInteger(state.skillState?.pointLoadSpanIndex) ?? (spans.indexOf(Math.max(...spans)) + 1)) - 1,
    ),
  );
  const explicitPointLoadX = readPositiveNumber(state.skillState?.pointLoadXM);
  const middleSupportX = supportCoordinates.length > 2
    ? supportCoordinates[Math.floor((supportCoordinates.length - 1) / 2)]
    : undefined;
  const pointLoadX = pointLoad !== undefined
    ? (
        explicitPointLoadX
        ?? (
          explicitPointLoad === undefined
          && (state.loadPosition === undefined || state.loadPosition === 'middle-joint')
          && middleSupportX !== undefined
            ? middleSupportX
            : supportCoordinates[pointSpanIndex] + spans[pointSpanIndex] / 2
        )
      )
    : undefined;
  const coordinates = Array.from(new Set([
    ...supportCoordinates,
    ...(pointLoadX !== undefined ? [pointLoadX] : []),
  ])).sort((left, right) => left - right);
  const pinned = [true, true, true, true, true, false];
  const roller = [false, true, true, true, true, false];
  const nodes = coordinates.map((x, index) => {
    const supportIndex = supportCoordinates.findIndex((supportX) => Math.abs(supportX - x) < 1e-9);
    const node: Record<string, unknown> = { id: `${index + 1}`, x, y: 0, z: 0 };
    if (supportIndex >= 0) {
      node.restraints = supportIndex === 0 ? pinned : roller;
    }
    return node;
  });
  const elements = coordinates.slice(0, -1).map((_x, index) => ({
    id: `${index + 1}`,
    type: 'beam',
    nodes: [`${index + 1}`, `${index + 2}`],
    material: '1',
    section: '1',
  }));
  const distributedLoad = readPositiveNumber(state.skillState?.distributedLoadKNM)
    ?? ((state.loadType === 'distributed' || state.loadPosition === 'full-span') ? state.loadKN : undefined);
  const loads: Array<Record<string, unknown>> = [];
  if (distributedLoad !== undefined) {
    for (const element of elements) {
      loads.push({ type: 'distributed', element: element.id, wz: -distributedLoad, wy: 0 });
    }
  }
  if (pointLoad !== undefined && pointLoadX !== undefined) {
    const nodeIndex = coordinates.findIndex((x) => Math.abs(x - pointLoadX) < 1e-9);
    loads.push({ node: `${nodeIndex + 1}`, fz: -pointLoad });
  }

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
    ],
    sections: [
      { id: '1', name: 'CONTINUOUS_BEAM', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      spanCount: spans.length,
      geometry: {
        spanLengthsM: spans,
      },
    },
  };
}

function getPortalFrameSpanLengths(state: DraftState): number[] {
  const explicit = readPositiveNumberArray(state.skillState?.portalBaySpansM);
  if (explicit?.length) {
    return explicit;
  }
  const span = state.spanLengthM!;
  const bayCount = Math.max(1, readPositiveInteger(state.skillState?.portalBayCount) ?? 1);
  return Array.from({ length: bayCount }, () => span);
}

function buildPortalFrameModel(state: DraftState, metadata: Record<string, unknown>): Record<string, unknown> {
  const spans = getPortalFrameSpanLengths(state);
  const xCoordinates = accumulateCoordinates(spans);
  const height = state.heightM!;
  const roofLoad = readPositiveNumber(state.skillState?.roofLoadKNM)
    ?? ((state.loadType === 'distributed' || state.loadPosition === 'full-span') ? state.loadKN : undefined);
  const nodalLoad = roofLoad === undefined ? state.loadKN! : undefined;
  const craneLoad = readPositiveNumber(state.skillState?.craneLoadKN);
  const mezzanineHeight = readPositiveNumber(state.skillState?.mezzanineHeightM);
  const mezzanineLoad = readPositiveNumber(state.skillState?.mezzanineLoadKN);
  const hasMezzanine = mezzanineHeight !== undefined && mezzanineHeight > 0 && mezzanineHeight < height && spans.length >= 1;
  const baseRestraint = buildFixedRestraint(state.frameBaseSupportType || 'fixed');
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loads: Array<Record<string, unknown>> = [];

  for (let i = 0; i < xCoordinates.length; i += 1) {
    nodes.push({ id: `B${i}`, x: xCoordinates[i], y: 0, z: 0, restraints: [...baseRestraint] });
    nodes.push({ id: `T${i}`, x: xCoordinates[i], y: 0, z: height });
  }
  if (hasMezzanine) {
    nodes.push({ id: 'M0', x: 0, y: 0, z: mezzanineHeight });
    nodes.push({ id: 'M1', x: Math.min(spans[0] / 3, spans[0]), y: 0, z: mezzanineHeight });
  }

  for (let i = 0; i < xCoordinates.length; i += 1) {
    if (hasMezzanine && i === 0) {
      elements.push({ id: `C${i}a`, type: 'beam', nodes: [`B${i}`, 'M0'], material: '1', section: '1' });
      elements.push({ id: `C${i}b`, type: 'beam', nodes: ['M0', `T${i}`], material: '1', section: '1' });
    } else {
      elements.push({ id: `C${i}`, type: 'beam', nodes: [`B${i}`, `T${i}`], material: '1', section: '1' });
    }
  }
  for (let i = 0; i < spans.length; i += 1) {
    const element = { id: `R${i}`, type: 'beam', nodes: [`T${i}`, `T${i + 1}`], material: '1', section: '1' };
    elements.push(element);
    if (roofLoad !== undefined) {
      loads.push({ type: 'distributed', element: element.id, wz: -roofLoad, wy: 0 });
    }
  }
  if (hasMezzanine) {
    elements.push({ id: 'MEZ1', type: 'beam', nodes: ['M0', 'M1'], material: '1', section: '1' });
    if (mezzanineLoad !== undefined) {
      loads.push({ node: 'M1', fz: -mezzanineLoad });
    }
  }
  if (nodalLoad !== undefined) {
    const perTopNode = -nodalLoad / xCoordinates.length;
    for (let i = 0; i < xCoordinates.length; i += 1) {
      loads.push({ type: 'nodal', node: `T${i}`, forces: [0, 0, perTopNode, 0, 0, 0] });
    }
  }
  if (craneLoad !== undefined) {
    const target = xCoordinates.length > 2 ? 'T1' : 'T0';
    loads.push({ node: target, fz: -craneLoad });
  }

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [
      { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
    ],
    sections: [
      { id: '1', name: 'PF1', type: 'beam', properties: { A: 0.02, Iy: 0.0002, Iz: 0.0002, J: 0.0002, G: 79000 } },
    ],
    load_cases: [
      { id: 'LC1', type: 'other', loads },
    ],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      bayCount: spans.length,
      hasMezzanine,
      geometry: {
        spanLengthsM: spans,
        heightM: height,
        mezzanineHeightM: hasMezzanine ? mezzanineHeight : undefined,
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
  if (state.inferredType === 'column') {
    return buildColumnModel(state, metadata);
  }
  if (state.inferredType === 'double-span-beam') {
    return buildContinuousBeamModel(state, metadata);
  }
  if (state.inferredType === 'portal-frame') {
    return buildPortalFrameModel(state, metadata);
  }
  const length = state.lengthM!;
  const load = state.loadKN!;
  const supportType = state.supportType || 'cantilever';
  const semanticBeamLoads = readRecordArray(state.skillState?.beamLoads);
  if (semanticBeamLoads?.length) {
    return buildSemanticBeamModel(state, metadata, semanticBeamLoads);
  }
  const simpleSpan = readPositiveNumber(state.skillState?.simpleSpanM);
  const overhangLength = readPositiveNumber(state.skillState?.overhangLengthM);
  const beamNodes = supportType === 'simply-supported' && simpleSpan !== undefined && overhangLength !== undefined
    ? buildOverhangingBeamNodes(simpleSpan, overhangLength)
    : buildBeamNodes(length, supportType, state.loadPositionM);
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
    metadata: { ...metadata, supportType, loadPositionM: state.loadPositionM, simpleSpanM: simpleSpan, overhangLengthM: overhangLength },
  };
}
