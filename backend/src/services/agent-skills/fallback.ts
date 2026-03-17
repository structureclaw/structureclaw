import type { AppLocale } from '../locale.js';
import type {
  AgentSkillBundle,
  DraftExtraction,
  DraftFloorLoad,
  DraftLoadPosition,
  DraftLoadType,
  DraftResult,
  DraftState,
  DraftSupportType,
  FrameBaseSupportType,
  FrameDimension,
  InferredModelType,
  InteractionQuestion,
  ScenarioMatch,
  ScenarioTemplateKey,
} from './types.js';

function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function extractNumber(text: string, patterns: RegExp[], groups: number[] = [1]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    for (const group of groups) {
      const value = match[group];
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function extractInteger(text: string, patterns: RegExp[], groups: number[] = [1]): number | undefined {
  const value = extractNumber(text, patterns, groups);
  if (value === undefined) {
    return undefined;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

function extractDirectionalLoadNumber(text: string, axis: 'x' | 'y'): number | undefined {
  const axisToken = axis === 'x' ? 'x' : 'y';
  return extractNumber(text, [
    new RegExp(`${axisToken}向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?[^\\n]{0,24}?${axisToken}向\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}向\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`lateral\\s*(?:load\\s*)?(?:in\\s*)?${axisToken}\\s*(?:direction)?\\s*(?:is|=)?\\s*(\\d+(?:\\.\\d+)?)\\s*kn`, 'i'),
  ]);
}

function shouldMirrorHorizontalLoadToBothAxes(
  text: string,
  frameDimension: FrameDimension | undefined,
): boolean {
  if (frameDimension !== '3d') {
    return false;
  }
  return (
    text.includes('水平方向荷载')
    || text.includes('水平荷载都是')
    || text.includes('水平荷载均为')
    || text.includes('横向荷载两个方向')
    || text.includes('侧向荷载两个方向')
    || text.includes('两个方向都是')
    || text.includes('horizontal loads')
  );
}

function repeatValue(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || !value || count <= 0 || value <= 0) {
    return undefined;
  }
  return Array.from({ length: count }, () => value);
}

function buildUniformFloorLoads(
  storyCount: number | undefined,
  verticalKN: number | undefined,
  lateralXKN: number | undefined,
  lateralYKN: number | undefined,
): DraftFloorLoad[] | undefined {
  if (!storyCount || storyCount <= 0) {
    return undefined;
  }
  if (verticalKN === undefined && lateralXKN === undefined && lateralYKN === undefined) {
    return undefined;
  }
  return Array.from({ length: storyCount }, (_, index) => ({
    story: index + 1,
    verticalKN,
    lateralXKN,
    lateralYKN,
  }));
}

function mergeFloorLoads(
  existing: DraftFloorLoad[] | undefined,
  incoming: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!existing?.length) {
    return incoming?.length ? [...incoming].sort((a, b) => a.story - b.story) : undefined;
  }
  if (!incoming?.length) {
    return [...existing].sort((a, b) => a.story - b.story);
  }

  const merged = new Map<number, DraftFloorLoad>();

  for (const load of existing) {
    merged.set(load.story, { ...load });
  }

  for (const load of incoming) {
    const current = merged.get(load.story);
    merged.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? current?.verticalKN,
      lateralXKN: load.lateralXKN ?? current?.lateralXKN,
      lateralYKN: load.lateralYKN ?? current?.lateralYKN,
    });
  }

  const normalized = Array.from(merged.values())
    .filter((load) => load.verticalKN !== undefined || load.lateralXKN !== undefined || load.lateralYKN !== undefined)
    .sort((a, b) => a.story - b.story);

  return normalized.length > 0 ? normalized : undefined;
}

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
  const yCoordinates = accumulateCoordinates(storyHeights);
  const baseSupport = state.frameBaseSupportType || 'fixed';
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loadCases = [{ id: 'LC1', type: 'other', loads: [] as Array<Record<string, unknown>> }];
  let elementId = 1;

  for (let storyIndex = 0; storyIndex < yCoordinates.length; storyIndex += 1) {
    for (let bayNodeIndex = 0; bayNodeIndex < xCoordinates.length; bayNodeIndex += 1) {
      const node: Record<string, unknown> = {
        id: get2dNodeId(storyIndex, bayNodeIndex),
        x: xCoordinates[bayNodeIndex],
        y: yCoordinates[storyIndex],
        z: 0,
      };
      if (storyIndex === 0) {
        node.restraints = buildFixedRestraint(baseSupport);
      }
      nodes.push(node);
    }
  }

  for (let storyIndex = 1; storyIndex < yCoordinates.length; storyIndex += 1) {
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

  for (let storyIndex = 1; storyIndex < yCoordinates.length; storyIndex += 1) {
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
    if (storyIndex <= 0 || storyIndex >= yCoordinates.length) {
      continue;
    }
    const verticalPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lateralPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    for (let bayNodeIndex = 0; bayNodeIndex < xCoordinates.length; bayNodeIndex += 1) {
      const nodeLoad: Record<string, unknown> = { node: get2dNodeId(storyIndex, bayNodeIndex) };
      if (verticalPerNode !== undefined) {
        nodeLoad.fy = verticalPerNode;
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
    schema_version: '1.0.0',
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
  const zCoordinates = accumulateCoordinates(bayWidthsY);
  const yCoordinates = accumulateCoordinates(storyHeights);
  const baseSupport = state.frameBaseSupportType || 'fixed';
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loadCases = [{ id: 'LC1', type: 'other', loads: [] as Array<Record<string, unknown>> }];
  let elementId = 1;

  for (let storyIndex = 0; storyIndex < yCoordinates.length; storyIndex += 1) {
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < zCoordinates.length; yIndex += 1) {
        const node: Record<string, unknown> = {
          id: get3dNodeId(storyIndex, xIndex, yIndex),
          x: xCoordinates[xIndex],
          y: yCoordinates[storyIndex],
          z: zCoordinates[yIndex],
        };
        if (storyIndex === 0) {
          node.restraints = buildFixedRestraint(baseSupport);
        }
        nodes.push(node);
      }
    }
  }

  for (let storyIndex = 1; storyIndex < yCoordinates.length; storyIndex += 1) {
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < zCoordinates.length; yIndex += 1) {
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

  for (let storyIndex = 1; storyIndex < yCoordinates.length; storyIndex += 1) {
    for (let xIndex = 0; xIndex < bayWidthsX.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < zCoordinates.length; yIndex += 1) {
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

  const levelNodeCount = xCoordinates.length * zCoordinates.length;
  for (const load of floorLoads) {
    const storyIndex = load.story;
    if (storyIndex <= 0 || storyIndex >= yCoordinates.length) {
      continue;
    }
    const verticalPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lateralXPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    const lateralYPerNode = load.lateralYKN !== undefined ? load.lateralYKN / levelNodeCount : undefined;
    for (let xIndex = 0; xIndex < xCoordinates.length; xIndex += 1) {
      for (let yIndex = 0; yIndex < zCoordinates.length; yIndex += 1) {
        const nodeLoad: Record<string, unknown> = { node: get3dNodeId(storyIndex, xIndex, yIndex) };
        if (verticalPerNode !== undefined) {
          nodeLoad.fy = verticalPerNode;
        }
        if (lateralXPerNode !== undefined) {
          nodeLoad.fx = lateralXPerNode;
        }
        if (lateralYPerNode !== undefined) {
          nodeLoad.fz = lateralYPerNode;
        }
        if (Object.keys(nodeLoad).length > 1) {
          loadCases[0].loads.push(nodeLoad);
        }
      }
    }
  }

  return {
    schema_version: '1.0.0',
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

export function normalizeLoadType(value: unknown): DraftLoadType | undefined {
  return value === 'point' || value === 'distributed' ? value : undefined;
}

export function normalizeSupportType(value: unknown): DraftSupportType | undefined {
  return value === 'cantilever' || value === 'simply-supported' || value === 'fixed-fixed' || value === 'fixed-pinned'
    ? value
    : undefined;
}

export function normalizeLoadPosition(value: unknown): DraftLoadPosition | undefined {
  if (
    value === 'end'
    || value === 'midspan'
    || value === 'full-span'
    || value === 'top-nodes'
    || value === 'middle-joint'
    || value === 'free-joint'
  ) {
    return value;
  }
  return undefined;
}

export function normalizeInferredType(value: unknown): InferredModelType | undefined {
  if (value === 'beam' || value === 'truss' || value === 'portal-frame' || value === 'double-span-beam' || value === 'frame' || value === 'unknown') {
    return value;
  }
  return undefined;
}

export function normalizeFrameDimension(value: unknown): FrameDimension | undefined {
  return value === '2d' || value === '3d' ? value : undefined;
}

export function normalizeFrameBaseSupportType(value: unknown): FrameBaseSupportType | undefined {
  return value === 'fixed' || value === 'pinned' ? value : undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = normalizeNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : undefined;
}

export function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((item) => normalizeNumber(item))
    .filter((item): item is number => item !== undefined && item > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeFloorLoads(value: unknown): DraftFloorLoad[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const row = item as Record<string, unknown>;
      const story = normalizePositiveInteger(row.story);
      if (!story) {
        return null;
      }
      const verticalKN = normalizeNumber(row.verticalKN);
      const lateralXKN = normalizeNumber(row.lateralXKN);
      const lateralYKN = normalizeNumber(row.lateralYKN);
      if (verticalKN === undefined && lateralXKN === undefined && lateralYKN === undefined) {
        return null;
      }
      return { story, verticalKN, lateralXKN, lateralYKN };
    });
  const filtered = normalized.filter((item) => item !== null) as DraftFloorLoad[];
  return filtered.length > 0 ? filtered : undefined;
}

export function buildUnsupportedScenario(
  locale: AppLocale,
  key: ScenarioTemplateKey,
  noteZh: string,
  noteEn: string,
): ScenarioMatch {
  return {
    key,
    mappedType: 'unknown',
    supportLevel: 'unsupported',
    supportNote: localize(locale, noteZh, noteEn),
  };
}

export function buildUnknownScenario(locale: AppLocale): ScenarioMatch {
  return buildUnsupportedScenario(
    locale,
    'unknown',
    '我还没有从当前描述中稳定识别出可直接补参的结构场景。请先说明它更接近梁、桁架、门式刚架还是规则框架。',
    'I have not yet identified a stable structural scenario from the current description. Please tell me whether it is closer to a beam, truss, portal frame, or regular frame.'
  );
}

export function detectUnsupportedScenarioByRules(message: string, locale: AppLocale): ScenarioMatch | null {
  const text = message.toLowerCase();
  if (text.includes('space frame') || text.includes('网架')) {
    return buildUnsupportedScenario(
      locale,
      'space-frame',
      '当前对话补参链路还不直接支持空间网架；如果你愿意，可先收敛成梁、桁架、门式刚架或规则框架进行澄清。',
      'The current guidance flow does not directly support space frames. If acceptable, we can first simplify the problem to a beam, truss, portal frame, or regular frame.'
    );
  }
  if (text.includes('slab') || text.includes('plate') || text.includes('楼板') || text.includes('板')) {
    return buildUnsupportedScenario(
      locale,
      'plate-slab',
      '当前补参链路还不直接支持板/楼板模型；请先确认是否可以简化为梁系、框架或桁架问题。',
      'The current guidance flow does not directly support plate or slab models. Please confirm whether the problem can be simplified into beams, frames, or trusses.'
    );
  }
  if (text.includes('shell') || text.includes('壳')) {
    return buildUnsupportedScenario(
      locale,
      'shell',
      '当前补参链路还不直接支持壳体模型；请先说明是否可以收敛到梁、桁架或规则框架的近似模型。',
      'The current guidance flow does not directly support shell models. Please clarify whether the problem can be reduced to a beam, truss, or regular-frame approximation.'
    );
  }
  if (text.includes('tower') || text.includes('塔')) {
    return buildUnsupportedScenario(
      locale,
      'tower',
      '当前补参链路还不直接支持塔架专用模板；如果只是杆系近似，可先按桁架继续澄清。',
      'The current guidance flow does not directly support tower-specific templates. If a truss approximation is acceptable, we can continue with that.'
    );
  }
  if (text.includes('bridge') || text.includes('桥')) {
    return buildUnsupportedScenario(
      locale,
      'bridge',
      '当前补参链路还不直接支持桥梁专用模板；若你只想先讨论主梁近似，可收敛到梁模板。',
      'The current guidance flow does not directly support bridge-specific templates. If you only want a girder-style approximation first, we can narrow the problem to a beam template.'
    );
  }
  return null;
}

export function extractDraftByRules(message: string): DraftExtraction {
  const text = message.toLowerCase();
  const inferredType = inferDraftType(text);

  const storyCount = extractInteger(text, [
    /(\d+)\s*层/i,
    /(\d+)\s*stories?/i,
  ]);
  const bayCount = extractInteger(text, [
    /(?<!x向|y向)(\d+)\s*跨/i,
    /(\d+)\s*bays?(?!\s*in\s*[xy])/i,
  ]);
  const bayCountX = extractInteger(text, [
    /x向\s*(\d+)\s*跨/i,
    /(\d+)\s*bays?\s*in\s*x/i,
  ]);
  const bayCountY = extractInteger(text, [
    /y向\s*(\d+)\s*跨/i,
    /(\d+)\s*bays?\s*in\s*y/i,
  ]);
  const scalarHeight = extractNumber(text, [
    /层高\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /每层\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /story height\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ]);
  const scalarBayWidth = extractNumber(text, [
    /每跨\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /bay width\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ]);
  const scalarBayWidthX = extractNumber(text, [
    /x向.*?每跨\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /x向(?:每跨)?\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /x\s*(?:bay width)?\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ]);
  const scalarBayWidthY = extractNumber(text, [
    /y向.*?每跨\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /y向(?:每跨)?\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /y\s*(?:bay width)?\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ]);
  const spanLengthM = extractNumber(text, [
    /双跨[^\d]*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /per span\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ]);
  const lengthM = extractNumber(text, [
    /(跨度|跨长|长度|长)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /(span|length)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ], [2, 1]);
  const heightM = extractNumber(text, [
    /(柱高|高度|高)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /(height|column height)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
  ], [2]);
  const loadKN = extractNumber(text, [
    /(\d+(?:\.\d+)?)\s*(?:kn|千牛)\s*\/\s*(?:m|米)/i,
    /(\d+(?:\.\d+)?)\s*(?:kn|千牛)(?!\s*\/\s*m)/i,
  ]);
  const verticalLoadKN = extractNumber(text, [
    /竖向荷载\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /每层竖向荷载\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /vertical load\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*kn/i,
  ]);
  const extractedLateralXLoadKN = extractNumber(text, [
    /(?:横向|侧向|水平)(?:方向)?荷载(?:两个方向)?(?:都?是|均为|都为|为|是)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /水平方向荷载(?:都?是|均为|为|是)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /水平荷载\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /lateral x load\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*kn/i,
    /horizontal load\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*kn/i,
  ]) ?? extractDirectionalLoadNumber(text, 'x');
  const extractedLateralYLoadKN = extractDirectionalLoadNumber(text, 'y');

  const frameDimension = inferFrameDimension(text, inferredType);
  const mirrorHorizontalLoad = shouldMirrorHorizontalLoadToBothAxes(text, frameDimension);
  const lateralXLoadKN = extractedLateralXLoadKN;
  const lateralYLoadKN = extractedLateralYLoadKN ?? (mirrorHorizontalLoad ? extractedLateralXLoadKN : undefined);
  const normalizedStoryCount = storyCount;
  const storyHeightsM = frameDimension
    ? repeatValue(normalizedStoryCount, scalarHeight)
    : undefined;
  const bayWidthsM = frameDimension === '2d'
    ? repeatValue(bayCount, scalarBayWidth ?? lengthM)
    : undefined;
  const bayWidthsXM = frameDimension === '3d'
    ? repeatValue(bayCountX, scalarBayWidthX ?? scalarBayWidth)
    : undefined;
  const bayWidthsYM = frameDimension === '3d'
    ? repeatValue(bayCountY, scalarBayWidthY)
    : undefined;
  const floorLoads = frameDimension
    ? buildUniformFloorLoads(
        normalizedStoryCount,
        verticalLoadKN,
        lateralXLoadKN,
        frameDimension === '3d' ? lateralYLoadKN : undefined,
      )
    : undefined;

  const supportType = extractSupportType(text);
  const loadType = extractLoadType(text);
  const loadPosition = extractLoadPosition(text, inferredType, loadType);
  const frameBaseSupportType = extractFrameBaseSupport(text);

  return {
    inferredType,
    lengthM: lengthM ?? undefined,
    spanLengthM: spanLengthM ?? undefined,
    heightM: heightM ?? undefined,
    supportType,
    frameDimension,
    storyCount: normalizedStoryCount,
    bayCount: bayCount ?? undefined,
    bayCountX: bayCountX ?? undefined,
    bayCountY: bayCountY ?? undefined,
    storyHeightsM,
    bayWidthsM,
    bayWidthsXM,
    bayWidthsYM,
    floorLoads,
    frameBaseSupportType,
    loadKN: loadKN ?? undefined,
    loadType,
    loadPosition,
  };
}

export function inferDraftType(text: string): InferredModelType {
  if (text.includes('门式刚架') || text.includes('portal frame')) {
    return 'portal-frame';
  }
  if (text.includes('双跨梁') || text.includes('double-span')) {
    return 'double-span-beam';
  }
  if (text.includes('桁架') || text.includes('truss')) {
    return 'truss';
  }
  if (text.includes('钢框架') || text.includes('frame') || text.includes('框架')) {
    return 'frame';
  }
  if (text.includes('梁') || text.includes('beam') || text.includes('悬臂')) {
    return 'beam';
  }
  return 'unknown';
}

function inferFrameDimension(text: string, inferredType: InferredModelType): FrameDimension | undefined {
  if (inferredType !== 'frame') {
    return undefined;
  }
  if (text.includes('3d') || text.includes('三维') || text.includes('空间框架') || text.includes('space frame') || text.includes('x向') && text.includes('y向')) {
    return '3d';
  }
  return '2d';
}

export function extractLoadType(text: string): DraftLoadType | undefined {
  if (text.includes('均布') || text.includes('distributed') || text.includes('uniform') || text.includes('udl')) {
    return 'distributed';
  }
  if (text.includes('点荷载') || text.includes('集中荷载') || text.includes('point load') || text.includes('concentrated')) {
    return 'point';
  }
  if (text.includes('端部') || text.includes('跨中') || text.includes('midspan') || text.includes('tip')) {
    return 'point';
  }
  return undefined;
}

export function extractSupportType(text: string): DraftSupportType | undefined {
  if (
    text.includes('fixed-pinned')
    || text.includes('fixed pinned')
    || text.includes('固铰')
    || text.includes('一端固结一端铰支')
  ) {
    return 'fixed-pinned';
  }
  if (
    text.includes('fixed-fixed')
    || text.includes('fixed fixed')
    || text.includes('两端固结')
    || text.includes('双固结')
  ) {
    return 'fixed-fixed';
  }
  if (
    text.includes('simply supported')
    || text.includes('simple support')
    || text.includes('简支')
  ) {
    return 'simply-supported';
  }
  if (text.includes('cantilever') || text.includes('悬臂')) {
    return 'cantilever';
  }
  return undefined;
}

function extractFrameBaseSupport(text: string): FrameBaseSupportType | undefined {
  if (text.includes('柱脚铰接') || text.includes('base pinned') || text.includes('pinned base')) {
    return 'pinned';
  }
  if (text.includes('柱脚固结') || text.includes('fixed base')) {
    return 'fixed';
  }
  return undefined;
}

export function extractLoadPosition(
  text: string,
  inferredType: InferredModelType,
  loadType: DraftLoadType | undefined,
): DraftLoadPosition | undefined {
  if (text.includes('柱顶') || text.includes('顶节点') || text.includes('top nodes')) {
    return 'top-nodes';
  }
  if (text.includes('中跨节点') || text.includes('中间节点') || text.includes('middle joint') || text.includes('center joint')) {
    return 'middle-joint';
  }
  if (text.includes('跨中') || text.includes('midspan') || text.includes('mid span')) {
    return 'midspan';
  }
  if (text.includes('全跨') || text.includes('整跨') || text.includes('满跨') || text.includes('full span') || text.includes('entire span')) {
    return 'full-span';
  }
  if (text.includes('端部') || text.includes('端点') || text.includes('tip') || text.includes('free end') || text.includes('at end')) {
    return 'end';
  }
  if (text.includes('节点') || text.includes('joint') || text.includes('node')) {
    return inferredType === 'double-span-beam' ? 'middle-joint' : 'free-joint';
  }
  if (loadType === 'distributed') {
    return inferredType === 'portal-frame' || inferredType === 'double-span-beam' || inferredType === 'beam'
      ? 'full-span'
      : undefined;
  }
  return undefined;
}

export function mergeDraftExtraction(preferred: DraftExtraction | null, fallback: DraftExtraction): DraftExtraction {
  return {
    inferredType: preferred?.inferredType && preferred.inferredType !== 'unknown' ? preferred.inferredType : fallback.inferredType,
    lengthM: preferred?.lengthM ?? fallback.lengthM,
    spanLengthM: preferred?.spanLengthM ?? fallback.spanLengthM,
    heightM: preferred?.heightM ?? fallback.heightM,
    supportType: preferred?.supportType ?? fallback.supportType,
    frameDimension: preferred?.frameDimension ?? fallback.frameDimension,
    storyCount: preferred?.storyCount ?? fallback.storyCount,
    bayCount: preferred?.bayCount ?? fallback.bayCount,
    bayCountX: preferred?.bayCountX ?? fallback.bayCountX,
    bayCountY: preferred?.bayCountY ?? fallback.bayCountY,
    storyHeightsM: preferred?.storyHeightsM ?? fallback.storyHeightsM,
    bayWidthsM: preferred?.bayWidthsM ?? fallback.bayWidthsM,
    bayWidthsXM: preferred?.bayWidthsXM ?? fallback.bayWidthsXM,
    bayWidthsYM: preferred?.bayWidthsYM ?? fallback.bayWidthsYM,
    floorLoads: preferred?.floorLoads ?? fallback.floorLoads,
    frameBaseSupportType: preferred?.frameBaseSupportType ?? fallback.frameBaseSupportType,
    loadKN: preferred?.loadKN ?? fallback.loadKN,
    loadType: preferred?.loadType ?? fallback.loadType,
    loadPosition: preferred?.loadPosition ?? fallback.loadPosition,
  };
}

export function mergeDraftState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const mergedType = patch.inferredType && patch.inferredType !== 'unknown' ? patch.inferredType : (existing?.inferredType || 'unknown');
  const mergedLength = patch.lengthM ?? existing?.lengthM;
  const mergedSpan = patch.spanLengthM ?? existing?.spanLengthM;
  const spanLengthM = mergedSpan ?? ((mergedType === 'portal-frame' || mergedType === 'double-span-beam') ? mergedLength : undefined);
  const storyCount = patch.storyCount ?? existing?.storyCount ?? patch.storyHeightsM?.length ?? existing?.storyHeightsM?.length;
  const bayCount = patch.bayCount ?? existing?.bayCount ?? patch.bayWidthsM?.length ?? existing?.bayWidthsM?.length;
  const bayCountX = patch.bayCountX ?? existing?.bayCountX ?? patch.bayWidthsXM?.length ?? existing?.bayWidthsXM?.length;
  const bayCountY = patch.bayCountY ?? existing?.bayCountY ?? patch.bayWidthsYM?.length ?? existing?.bayWidthsYM?.length;
  const frameDimension = patch.frameDimension ?? existing?.frameDimension;
  const storyHeightsM = patch.storyHeightsM ?? existing?.storyHeightsM ?? repeatValue(storyCount, patch.heightM ?? existing?.heightM);
  const bayWidthsM = patch.bayWidthsM ?? existing?.bayWidthsM;
  const bayWidthsXM = patch.bayWidthsXM ?? existing?.bayWidthsXM;
  const bayWidthsYM = patch.bayWidthsYM ?? existing?.bayWidthsYM;
  const floorLoads = mergeFloorLoads(existing?.floorLoads, patch.floorLoads);

  return {
    inferredType: mergedType,
    lengthM: mergedLength,
    spanLengthM,
    heightM: patch.heightM ?? existing?.heightM,
    supportType: patch.supportType ?? existing?.supportType,
    frameDimension,
    storyCount,
    bayCount,
    bayCountX,
    bayCountY,
    storyHeightsM,
    bayWidthsM: frameDimension === '2d'
      ? (bayWidthsM ?? repeatValue(bayCount, patch.lengthM ?? existing?.lengthM))
      : undefined,
    bayWidthsXM: frameDimension === '3d' ? bayWidthsXM : undefined,
    bayWidthsYM: frameDimension === '3d' ? bayWidthsYM : undefined,
    floorLoads: floorLoads ?? buildUniformFloorLoads(
      storyCount,
      patch.loadKN ?? existing?.loadKN,
      undefined,
      undefined,
    ),
    frameBaseSupportType: patch.frameBaseSupportType ?? existing?.frameBaseSupportType,
    loadKN: patch.loadKN ?? existing?.loadKN,
    loadType: patch.loadType ?? existing?.loadType,
    loadPosition: patch.loadPosition ?? existing?.loadPosition,
    updatedAt: Date.now(),
  };
}

export function computeMissingFields(state: DraftState): string[] {
  const missing: string[] = [];
  if (state.inferredType === 'unknown') {
    missing.push('结构类型（门式刚架/双跨梁/梁/平面桁架/规则框架）');
    return missing;
  }
  if (state.inferredType === 'frame') {
    if (state.frameDimension === undefined) {
      missing.push('框架维度（2D/3D）');
    }
    if (state.storyCount === undefined && !state.storyHeightsM?.length) {
      missing.push('层数');
    }
    if (!state.storyHeightsM?.length) {
      missing.push('各层层高（m）');
    }
    if (state.frameDimension === '2d') {
      if (state.bayCount === undefined && !state.bayWidthsM?.length) {
        missing.push('跨数');
      }
      if (!state.bayWidthsM?.length) {
        missing.push('各跨跨度（m）');
      }
    } else if (state.frameDimension === '3d') {
      if (state.bayCountX === undefined && !state.bayWidthsXM?.length) {
        missing.push('X向跨数');
      }
      if (!state.bayWidthsXM?.length) {
        missing.push('X向各跨跨度（m）');
      }
      if (state.bayCountY === undefined && !state.bayWidthsYM?.length) {
        missing.push('Y向跨数');
      }
      if (!state.bayWidthsYM?.length) {
        missing.push('Y向各跨跨度（m）');
      }
    }
    if (!state.floorLoads?.length) {
      missing.push('各层节点荷载（kN）');
    }
    return missing;
  }
  if (state.inferredType === 'portal-frame') {
    if (state.spanLengthM === undefined) {
      missing.push('门式刚架跨度（m）');
    }
    if (state.heightM === undefined) {
      missing.push('门式刚架柱高（m）');
    }
    if (state.loadKN === undefined) {
      missing.push('荷载大小（kN）');
    }
    return missing;
  }
  if (state.inferredType === 'double-span-beam') {
    if (state.spanLengthM === undefined) {
      missing.push('每跨跨度（m）');
    }
    if (state.loadKN === undefined) {
      missing.push('荷载大小（kN）');
    }
    return missing;
  }
  if (state.lengthM === undefined) {
    missing.push('跨度/长度（m）');
  }
  if (state.inferredType === 'beam' && state.supportType === undefined) {
    missing.push('支座/边界条件（悬臂/简支/两端固结/固铰）');
  }
  if (state.loadKN === undefined) {
    missing.push('荷载大小（kN）');
  }
  return missing;
}

export function computeMissingCriticalKeys(state: DraftState): string[] {
  const missing: string[] = [];
  if (state.inferredType === 'unknown') {
    missing.push('inferredType');
    return missing;
  }
  if (state.inferredType === 'frame') {
    if (state.frameDimension === undefined) {
      missing.push('frameDimension');
    }
    if (state.storyCount === undefined && !state.storyHeightsM?.length) {
      missing.push('storyCount');
    }
    if (!state.storyHeightsM?.length) {
      missing.push('storyHeightsM');
    }
    if (state.frameDimension === '2d') {
      if (state.bayCount === undefined && !state.bayWidthsM?.length) {
        missing.push('bayCount');
      }
      if (!state.bayWidthsM?.length) {
        missing.push('bayWidthsM');
      }
    } else if (state.frameDimension === '3d') {
      if (state.bayCountX === undefined && !state.bayWidthsXM?.length) {
        missing.push('bayCountX');
      }
      if (!state.bayWidthsXM?.length) {
        missing.push('bayWidthsXM');
      }
      if (state.bayCountY === undefined && !state.bayWidthsYM?.length) {
        missing.push('bayCountY');
      }
      if (!state.bayWidthsYM?.length) {
        missing.push('bayWidthsYM');
      }
    }
    if (!state.floorLoads?.length) {
      missing.push('floorLoads');
    }
    return missing;
  }
  if (state.inferredType === 'portal-frame') {
    if (state.spanLengthM === undefined) {
      missing.push('spanLengthM');
    }
    if (state.heightM === undefined) {
      missing.push('heightM');
    }
    if (state.loadKN === undefined) {
      missing.push('loadKN');
    }
    return missing;
  }
  if (state.inferredType === 'double-span-beam') {
    if (state.spanLengthM === undefined) {
      missing.push('spanLengthM');
    }
    if (state.loadKN === undefined) {
      missing.push('loadKN');
    }
    return missing;
  }
  if (state.lengthM === undefined) {
    missing.push('lengthM');
  }
  if (state.inferredType === 'beam' && state.supportType === undefined) {
    missing.push('supportType');
  }
  if (state.loadKN === undefined) {
    missing.push('loadKN');
  }
  return missing;
}

export function computeMissingLoadDetailKeys(state: DraftState): string[] {
  if (state.inferredType === 'unknown' || state.inferredType === 'frame') {
    return [];
  }
  if (state.inferredType === 'beam' && state.supportType === undefined) {
    return [];
  }
  const missing: string[] = [];
  if (state.loadType === undefined) {
    missing.push('loadType');
  }
  if (state.loadPosition === undefined) {
    missing.push('loadPosition');
  }
  return missing;
}

export function mapMissingFieldLabels(missing: string[], locale: AppLocale): string[] {
  return missing.map((key) => {
    switch (key) {
      case 'inferredType':
        return localize(locale, '结构类型（门式刚架/双跨梁/梁/平面桁架/规则框架）', 'Structure type (portal frame / double-span beam / beam / truss / regular frame)');
      case 'lengthM':
        return localize(locale, '跨度/长度（m）', 'Span / length (m)');
      case 'spanLengthM':
        return localize(locale, '门式刚架或双跨每跨跨度（m）', 'Span length per bay for the portal frame or double-span beam (m)');
      case 'heightM':
        return localize(locale, '门式刚架柱高（m）', 'Portal-frame column height (m)');
      case 'supportType':
        return localize(locale, '支座/边界条件（悬臂/简支/两端固结/固铰）', 'Support condition (cantilever / simply supported / fixed-fixed / fixed-pinned)');
      case 'frameDimension':
        return localize(locale, '框架维度（2D/3D）', 'Frame dimension (2D / 3D)');
      case 'storyCount':
        return localize(locale, '层数', 'Story count');
      case 'bayCount':
        return localize(locale, '跨数', 'Bay count');
      case 'bayCountX':
        return localize(locale, 'X向跨数', 'Bay count in X');
      case 'bayCountY':
        return localize(locale, 'Y向跨数', 'Bay count in Y');
      case 'storyHeightsM':
        return localize(locale, '各层层高（m）', 'Story heights (m)');
      case 'bayWidthsM':
        return localize(locale, '各跨跨度（m）', 'Bay widths (m)');
      case 'bayWidthsXM':
        return localize(locale, 'X向各跨跨度（m）', 'Bay widths in X (m)');
      case 'bayWidthsYM':
        return localize(locale, 'Y向各跨跨度（m）', 'Bay widths in Y (m)');
      case 'floorLoads':
        return localize(locale, '各层节点荷载（kN）', 'Per-floor nodal loads (kN)');
      case 'loadKN':
        return localize(locale, '荷载大小（kN）', 'Load magnitude (kN)');
      case 'loadType':
        return localize(locale, '荷载形式（点荷载/均布荷载）', 'Load type (point / distributed)');
      case 'loadPosition':
        return localize(locale, '荷载位置（按当前结构模板）', 'Load position (based on the current template)');
      default:
        return key;
    }
  });
}

export function buildSupportTypeQuestion(locale: AppLocale): string {
  return localize(
    locale,
    '请确认支座/边界条件（悬臂、简支、两端固结或固铰）。',
    'Please confirm the support condition (cantilever, simply supported, fixed-fixed, or fixed-pinned).'
  );
}

export function buildLoadTypeQuestion(type: InferredModelType, locale: AppLocale): string {
  switch (type) {
    case 'beam':
      return localize(locale, '请确认荷载形式（点荷载或均布荷载）。', 'Please confirm the load type (point or distributed).');
    case 'portal-frame':
      return localize(locale, '请确认门式刚架荷载形式（柱顶节点点荷载或檐梁均布荷载）。', 'Please confirm the portal-frame load type (top-node point load or distributed load on the rafter).');
    case 'double-span-beam':
      return localize(locale, '请确认双跨梁荷载形式（中间节点点荷载或两跨均布荷载）。', 'Please confirm the double-span load type (middle-joint point load or distributed load over both spans).');
    case 'truss':
      return localize(locale, '请确认桁架荷载形式（当前建议使用节点点荷载）。', 'Please confirm the truss load type (node point load is currently recommended).');
    default:
      return localize(locale, '请确认荷载形式（点荷载或均布荷载）。', 'Please confirm the load type (point or distributed).');
  }
}

export function buildLoadPositionQuestion(type: InferredModelType, locale: AppLocale): string {
  switch (type) {
    case 'beam':
      return localize(locale, '请确认荷载位置（端部/跨中/全跨）。', 'Please confirm the load position (end / midspan / full span).');
    case 'portal-frame':
      return localize(locale, '请确认荷载位置（柱顶节点/檐梁全跨）。', 'Please confirm the load position (top nodes / full rafter span).');
    case 'double-span-beam':
      return localize(locale, '请确认荷载位置（中间节点/两跨全跨）。', 'Please confirm the load position (middle joint / full span over both bays).');
    case 'truss':
      return localize(locale, '请确认荷载位置（受力节点）。', 'Please confirm the loaded joint.');
    default:
      return localize(locale, '请确认荷载位置。', 'Please confirm the load position.');
  }
}

export function buildInteractionQuestions(
  missingKeys: string[],
  criticalMissing: string[],
  draft: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return missingKeys.map((paramKey) => {
    const critical = criticalMissing.includes(paramKey);
    switch (paramKey) {
      case 'inferredType':
        return { paramKey, label: localize(locale, '结构类型', 'Structure type'), question: localize(locale, '请确认结构类型（门式刚架/双跨梁/梁/平面桁架/规则框架）。', 'Please confirm the structure type (portal frame / double-span beam / beam / truss / regular frame).'), required: true, critical };
      case 'lengthM':
        return { paramKey, label: localize(locale, '跨度/长度', 'Span / length'), question: localize(locale, '请确认跨度或长度。', 'Please confirm the span or length.'), unit: 'm', required: true, critical };
      case 'spanLengthM':
        return { paramKey, label: localize(locale, '每跨跨度', 'Span per bay'), question: localize(locale, '请确认门式刚架或双跨梁每跨跨度。', 'Please confirm the span length for each bay of the portal frame or double-span beam.'), unit: 'm', required: true, critical };
      case 'heightM':
        return { paramKey, label: localize(locale, '柱高', 'Column height'), question: localize(locale, '请确认门式刚架柱高。', 'Please confirm the portal-frame column height.'), unit: 'm', required: true, critical };
      case 'supportType':
        return { paramKey, label: localize(locale, '支座条件', 'Support condition'), question: buildSupportTypeQuestion(locale), required: true, critical, suggestedValue: 'simply-supported' };
      case 'frameDimension':
        return { paramKey, label: localize(locale, '框架维度', 'Frame dimension'), question: localize(locale, '请确认这是 2D 平面框架还是 3D 规则轴网框架。', 'Please confirm whether this is a 2D planar frame or a 3D regular-grid frame.'), required: true, critical, suggestedValue: '2d' };
      case 'storyCount':
        return { paramKey, label: localize(locale, '层数', 'Story count'), question: localize(locale, '请确认框架层数。', 'Please confirm the number of stories.'), required: true, critical };
      case 'bayCount':
        return { paramKey, label: localize(locale, '跨数', 'Bay count'), question: localize(locale, '请确认 2D 框架跨数。', 'Please confirm the number of bays for the 2D frame.'), required: true, critical };
      case 'bayCountX':
        return { paramKey, label: localize(locale, 'X向跨数', 'Bay count in X'), question: localize(locale, '请确认 3D 框架 X 向跨数。', 'Please confirm the number of bays in the X direction for the 3D frame.'), required: true, critical };
      case 'bayCountY':
        return { paramKey, label: localize(locale, 'Y向跨数', 'Bay count in Y'), question: localize(locale, '请确认 3D 框架 Y 向跨数。', 'Please confirm the number of bays in the Y direction for the 3D frame.'), required: true, critical };
      case 'storyHeightsM':
        return { paramKey, label: localize(locale, '层高', 'Story heights'), question: localize(locale, '请确认各层层高；若各层相同，也可以直接说“每层 3m”。', 'Please confirm the story heights. If all stories are identical, you can simply say “3 m per story”.'), unit: 'm', required: true, critical };
      case 'bayWidthsM':
        return { paramKey, label: localize(locale, '各跨跨度', 'Bay widths'), question: localize(locale, '请确认 2D 框架各跨跨度；若相同，也可以直接说“每跨 6m”。', 'Please confirm the bay widths for the 2D frame. If all bays are identical, you can simply say “6 m per bay”.'), unit: 'm', required: true, critical };
      case 'bayWidthsXM':
        return { paramKey, label: localize(locale, 'X向各跨跨度', 'Bay widths in X'), question: localize(locale, '请确认 3D 框架 X 向各跨跨度。', 'Please confirm the bay widths in the X direction for the 3D frame.'), unit: 'm', required: true, critical };
      case 'bayWidthsYM':
        return { paramKey, label: localize(locale, 'Y向各跨跨度', 'Bay widths in Y'), question: localize(locale, '请确认 3D 框架 Y 向各跨跨度。', 'Please confirm the bay widths in the Y direction for the 3D frame.'), unit: 'm', required: true, critical };
      case 'floorLoads':
        return { paramKey, label: localize(locale, '各层荷载', 'Per-floor loads'), question: localize(locale, '请确认各层节点荷载（至少给出每层竖向荷载；2D 框架可补水平荷载，3D 框架可补 X/Y 向水平荷载）。', 'Please confirm the per-floor nodal loads. At minimum provide the vertical load for each story; you may also add lateral loads in X for 2D or X/Y for 3D.'), unit: 'kN', required: true, critical };
      case 'loadKN':
        return { paramKey, label: localize(locale, '荷载', 'Load'), question: localize(locale, '请确认控制荷载大小。', 'Please confirm the controlling load magnitude.'), unit: 'kN', required: true, critical };
      case 'loadType':
        return { paramKey, label: localize(locale, '荷载形式', 'Load type'), question: buildLoadTypeQuestion(draft.inferredType, locale), required: true, critical, suggestedValue: 'point' };
      case 'loadPosition':
        return { paramKey, label: localize(locale, '荷载位置', 'Load position'), question: buildLoadPositionQuestion(draft.inferredType, locale), required: true, critical };
      default:
        return { paramKey, label: paramKey, question: localize(locale, `请确认参数 ${paramKey}。`, `Please confirm parameter ${paramKey}.`), required: true, critical };
    }
  });
}

export function getScenarioLabel(key: ScenarioTemplateKey, locale: AppLocale, bundles: AgentSkillBundle[]): string {
  const matched = bundles.find((bundle) => bundle.id === key || bundle.structureType === key);
  if (matched) {
    return locale === 'zh' ? matched.name.zh : matched.name.en;
  }
  switch (key) {
    case 'frame':
      return localize(locale, '框架', 'Frame');
    case 'steel-frame':
      return localize(locale, '钢框架', 'Steel Frame');
    case 'portal':
      return localize(locale, '门架/刚架', 'Portal Structure');
    case 'girder':
      return localize(locale, '主梁/大梁', 'Girder');
    case 'space-frame':
      return localize(locale, '空间网架', 'Space Frame');
    case 'plate-slab':
      return localize(locale, '板/楼板', 'Plate or Slab');
    case 'shell':
      return localize(locale, '壳体', 'Shell');
    case 'tower':
      return localize(locale, '塔架', 'Tower');
    case 'bridge':
      return localize(locale, '桥梁', 'Bridge');
    default:
      return localize(locale, '未识别', 'Unclassified');
  }
}

function buildBeamNodes(length: number, supportType: DraftSupportType) {
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

  return {
    nodes: [
      { id: '1', x: 0, y: 0, z: 0, restraints: leftRestraint },
      { id: '2', x: length / 2, y: 0, z: 0 },
      rightRestraint
        ? { id: '3', x: length, y: 0, z: 0, restraints: rightRestraint }
        : { id: '3', x: length, y: 0, z: 0 },
    ],
    elements: [
      { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
      { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
    ],
    middleNodeId: '2',
    endNodeId: '3',
  };
}

function buildBeamLoads(
  loadKN: number,
  loadType: DraftLoadType | undefined,
  loadPosition: DraftLoadPosition | undefined,
  middleNodeId: string,
  endNodeId: string,
) {
  if (loadType === 'distributed' || loadPosition === 'full-span') {
    return [
      { type: 'distributed', element: '1', wy: -loadKN, wz: 0 },
      { type: 'distributed', element: '2', wy: -loadKN, wz: 0 },
    ];
  }

  if (loadPosition === 'midspan') {
    return [{ node: middleNodeId, fy: -loadKN }];
  }

  return [{ node: endNodeId, fy: -loadKN }];
}

export function buildModel(state: DraftState): Record<string, unknown> {
  const metadata = {
    source: 'markdown-skill-draft',
    inferredType: state.inferredType,
  };
  if (state.inferredType === 'frame') {
    if (state.frameDimension === '3d') {
      return buildFrame3dModel(state, metadata);
    }
    return buildFrame2dModel(state, metadata);
  }
  if (state.inferredType === 'truss') {
    const length = state.lengthM!;
    const load = state.loadKN!;
    return {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: length, y: 0, z: 0, restraints: [false, true, true, true, true, true] },
      ],
      elements: [
        { id: '1', type: 'truss', nodes: ['1', '2'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'T1', type: 'rod', properties: { A: 0.01 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [{ node: '2', fx: load }] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  if (state.inferredType === 'double-span-beam') {
    const span = state.spanLengthM!;
    const load = state.loadKN!;
    return {
      schema_version: '1.0.0',
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
        { id: 'LC1', type: 'other', loads: [{ node: '2', fy: -load }] },
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
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: span, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '3', x: 0, y: height, z: 0 },
        { id: '4', x: span, y: height, z: 0 },
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
          { type: 'nodal', node: '3', forces: [0, -load / 2, 0, 0, 0, 0] },
          { type: 'nodal', node: '4', forces: [0, -load / 2, 0, 0, 0, 0] },
        ] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }
  const length = state.lengthM!;
  const load = state.loadKN!;
  const supportType = state.supportType || 'cantilever';
  const beamNodes = buildBeamNodes(length, supportType);
  const beamLoads = buildBeamLoads(load, state.loadType, state.loadPosition, beamNodes.middleNodeId, beamNodes.endNodeId);
  return {
    schema_version: '1.0.0',
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
    metadata: { ...metadata, supportType },
  };
}

export function buildDraftResult(message: string, existingState: DraftState | undefined, llmExtraction: DraftExtraction | null): DraftResult {
  const ruleExtraction = extractDraftByRules(message);
  const extractionMode: 'llm' | 'rule-based' = llmExtraction ? 'llm' : 'rule-based';
  const mergedExtraction = mergeDraftExtraction(llmExtraction, ruleExtraction);
  const mergedState = mergeDraftState(existingState, mergedExtraction);
  const missingFields = computeMissingFields(mergedState);
  if (missingFields.length > 0) {
    return {
      inferredType: mergedState.inferredType,
      missingFields,
      extractionMode,
      stateToPersist: mergedState,
    };
  }
  return {
    inferredType: mergedState.inferredType,
    missingFields: [],
    extractionMode,
    model: buildModel(mergedState),
    stateToPersist: mergedState,
  };
}
