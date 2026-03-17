import type {
  DraftExtraction,
  DraftLoadPosition,
  DraftLoadType,
  DraftState,
  DraftSupportType,
  InferredModelType,
} from './agent-skills/index.js';

export function normalizeNoSkillDraftState(state: DraftState): DraftState {
  if (state.inferredType !== 'unknown') {
    return state;
  }

  if (state.supportType || state.loadPositionM !== undefined || state.loadType !== undefined) {
    return {
      ...state,
      inferredType: 'beam',
    };
  }

  return state;
}

export function computeNoSkillMissingFields(state: DraftState): string[] {
  const missing: string[] = [];
  const effectiveLength = state.lengthM ?? state.spanLengthM;
  if (effectiveLength === undefined) {
    missing.push('主要几何参数（跨度/层高/层数/轴网）');
  }
  if (state.loadKN === undefined && !state.floorLoads?.length) {
    missing.push('作用荷载信息（大小/方向/位置）');
  }
  return missing;
}

export function buildNoSkillGenericModel(state: DraftState): Record<string, unknown> {
  const length = state.lengthM ?? state.spanLengthM;
  const load = state.loadKN;
  if (length === undefined || load === undefined) {
    throw new Error('no-skill generic model requires length and load');
  }

  const supportType = state.supportType || 'simply-supported';
  const fixedRestraint = [true, true, true, true, true, true];
  const pinnedRestraint = [true, true, true, true, true, false];
  const rollerRestraint = [false, true, true, true, true, false];
  const leftRestraint = supportType === 'simply-supported'
    ? pinnedRestraint
    : fixedRestraint;
  const rightRestraint = supportType === 'simply-supported'
    ? rollerRestraint
    : supportType === 'fixed-fixed'
      ? fixedRestraint
      : supportType === 'fixed-pinned'
        ? pinnedRestraint
        : undefined;
  const loadPositionM = typeof state.loadPositionM === 'number'
    && state.loadPositionM > 0
    && state.loadPositionM < length
    ? state.loadPositionM
    : undefined;
  const pointLoadX = loadPositionM ?? (state.loadPosition === 'midspan' ? length / 2 : length);
  const nodes = [
    { id: '1', x: 0, y: 0, z: 0, restraints: leftRestraint },
    { id: '2', x: pointLoadX, y: 0, z: 0 },
    rightRestraint
      ? { id: '3', x: length, y: 0, z: 0, restraints: rightRestraint }
      : { id: '3', x: length, y: 0, z: 0 },
  ];
  const elements = [
    { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
    { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
  ];
  const loads = state.loadType === 'distributed' || state.loadPosition === 'full-span'
    ? [
        { type: 'distributed', element: '1', wy: -load, wz: 0 },
        { type: 'distributed', element: '2', wy: -load, wz: 0 },
      ]
    : [{ node: '2', fy: -load }];

  return {
    schema_version: '1.0.0',
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
    metadata: {
      source: 'generic-no-skill',
      inferredType: state.inferredType,
      supportType,
      loadPositionM: loadPositionM ?? pointLoadX,
    },
  };
}

export function extractNoSkillDraftByRules(message: string): DraftExtraction {
  const text = message.toLowerCase();
  const spanLengthM = extractNumber(text, [
    /每跨\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /双跨[^\d]*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    /each span\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
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
    /(load)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*kn/i,
  ]);
  const supportType = extractSupportType(text) ?? undefined;
  const loadType = extractLoadType(text);
  const loadPosition = extractLoadPosition(text, 'unknown', loadType);
  const loadPositionM = extractLoadPositionOffsetM(text);
  const inferredType: InferredModelType = supportType || loadPositionM !== undefined ? 'beam' : 'unknown';

  return {
    inferredType,
    lengthM: lengthM ?? undefined,
    spanLengthM: spanLengthM ?? undefined,
    heightM: heightM ?? undefined,
    supportType,
    loadKN: loadKN ?? undefined,
    loadType,
    loadPosition,
    loadPositionM,
  };
}

function extractLoadPositionOffsetM(text: string): number | undefined {
  const patterns: RegExp[] = [
    /荷载[\s\S]{0,20}?(?:在|距(?:离)?(?:左端|左支座|左侧)?|离(?:左端|左支座)?)\s*(\d+(?:\.\d+)?)\s*(?:m|米)(?:处|位置|点)?/i,
    /(?:point load|concentrated load)[\s\S]{0,20}?(?:at|@|from(?: the)? left(?: end| support)?(?: by)?)\s*(\d+(?:\.\d+)?)\s*m/i,
    /at\s*(\d+(?:\.\d+)?)\s*m\s*(?:from\s*(?:the\s*)?(?:left|start))/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const value = normalizeNumber(match[1]);
    if (value !== undefined && value >= 0) {
      return value;
    }
  }

  return undefined;
}

function extractLoadType(text: string): DraftLoadType | undefined {
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

function extractSupportType(text: string): DraftSupportType | undefined {
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
  if (text.includes('simply supported') || text.includes('simple support') || text.includes('简支')) {
    return 'simply-supported';
  }
  if (text.includes('cantilever') || text.includes('悬臂')) {
    return 'cantilever';
  }
  return undefined;
}

function extractLoadPosition(
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

function extractNumber(text: string, patterns: RegExp[], groupPriority: number[] = [1]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    for (const groupIndex of groupPriority) {
      const valueText = match[groupIndex];
      if (!valueText) {
        continue;
      }
      const value = Number.parseFloat(valueText);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

function normalizeNumber(value: unknown): number | undefined {
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
