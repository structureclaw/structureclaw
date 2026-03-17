import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
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

export function mergeNoSkillDraftExtraction(
  preferred: DraftExtraction | null,
  fallback: DraftExtraction,
): DraftExtraction {
  return {
    inferredType: preferred?.inferredType && preferred.inferredType !== 'unknown'
      ? preferred.inferredType
      : fallback.inferredType,
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
    loadPositionM: preferred?.loadPositionM ?? fallback.loadPositionM,
  };
}

export function mergeNoSkillDraftState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const mergedType = patch.inferredType && patch.inferredType !== 'unknown'
    ? patch.inferredType
    : (existing?.inferredType || 'unknown');
  const mergedLength = patch.lengthM ?? existing?.lengthM;
  const mergedSpan = patch.spanLengthM ?? existing?.spanLengthM;
  const spanLengthM = mergedSpan ?? (
    (mergedType === 'portal-frame' || mergedType === 'double-span-beam')
      ? mergedLength
      : undefined
  );
  const storyCount = patch.storyCount ?? existing?.storyCount ?? patch.storyHeightsM?.length ?? existing?.storyHeightsM?.length;
  const bayCount = patch.bayCount ?? existing?.bayCount ?? patch.bayWidthsM?.length ?? existing?.bayWidthsM?.length;
  const bayCountX = patch.bayCountX ?? existing?.bayCountX ?? patch.bayWidthsXM?.length ?? existing?.bayWidthsXM?.length;
  const bayCountY = patch.bayCountY ?? existing?.bayCountY ?? patch.bayWidthsYM?.length ?? existing?.bayWidthsYM?.length;

  return {
    inferredType: mergedType,
    lengthM: mergedLength,
    spanLengthM,
    heightM: patch.heightM ?? existing?.heightM,
    supportType: patch.supportType ?? existing?.supportType,
    frameDimension: patch.frameDimension ?? existing?.frameDimension,
    storyCount,
    bayCount,
    bayCountX,
    bayCountY,
    storyHeightsM: patch.storyHeightsM ?? existing?.storyHeightsM,
    bayWidthsM: patch.bayWidthsM ?? existing?.bayWidthsM,
    bayWidthsXM: patch.bayWidthsXM ?? existing?.bayWidthsXM,
    bayWidthsYM: patch.bayWidthsYM ?? existing?.bayWidthsYM,
    floorLoads: mergeFloorLoads(existing?.floorLoads, patch.floorLoads),
    frameBaseSupportType: patch.frameBaseSupportType ?? existing?.frameBaseSupportType,
    loadKN: patch.loadKN ?? existing?.loadKN,
    loadType: patch.loadType ?? existing?.loadType,
    loadPosition: patch.loadPosition ?? existing?.loadPosition,
    loadPositionM: patch.loadPositionM ?? existing?.loadPositionM,
    updatedAt: Date.now(),
  };
}

export async function tryNoSkillLlmBuildGenericModel(
  llm: ChatOpenAI | null,
  message: string,
  state: DraftState,
  locale: AppLocale,
): Promise<Record<string, unknown> | undefined> {
  if (!llm) {
    return undefined;
  }

  const stateHint = JSON.stringify(state);
  const prompt = locale === 'zh'
    ? [
        '你是结构建模专家。',
        '请根据用户描述输出可计算的 StructureModel v1 JSON。',
        '只输出 JSON 对象，不要 Markdown。',
        '至少包含: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations。',
        `已有草模信息: ${stateHint}`,
        `用户输入: ${message}`,
      ].join('\n')
    : [
        'You are a structural modeling expert.',
        'Generate a computable StructureModel v1 JSON from the user request.',
        'Return JSON object only, without markdown.',
        'At minimum include: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations.',
        `Current draft hints: ${stateHint}`,
        `User request: ${message}`,
      ].join('\n');

  try {
    const aiMessage = await llm.invoke(prompt);
    const content = typeof aiMessage.content === 'string'
      ? aiMessage.content
      : JSON.stringify(aiMessage.content);
    const parsed = parseJsonObject(content);
    if (!parsed) {
      return undefined;
    }

    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.elements) || !Array.isArray(parsed.load_cases)) {
      return undefined;
    }

    if (typeof parsed.schema_version !== 'string') {
      parsed.schema_version = '1.0.0';
    }
    if (typeof parsed.unit_system !== 'string') {
      parsed.unit_system = 'SI';
    }

    return parsed;
  } catch {
    return undefined;
  }
}

export async function tryNoSkillLlmExtract(
  llm: ChatOpenAI | null,
  message: string,
  existingState: DraftState | undefined,
  locale: AppLocale = 'en',
): Promise<DraftExtraction | null> {
  if (!llm) {
    return null;
  }

  const prior = existingState
    ? JSON.stringify({
        inferredType: existingState.inferredType,
        lengthM: existingState.lengthM,
        spanLengthM: existingState.spanLengthM,
        heightM: existingState.heightM,
        supportType: existingState.supportType,
        frameDimension: existingState.frameDimension,
        storyCount: existingState.storyCount,
        bayCount: existingState.bayCount,
        bayCountX: existingState.bayCountX,
        bayCountY: existingState.bayCountY,
        storyHeightsM: existingState.storyHeightsM,
        bayWidthsM: existingState.bayWidthsM,
        bayWidthsXM: existingState.bayWidthsXM,
        bayWidthsYM: existingState.bayWidthsYM,
        floorLoads: existingState.floorLoads,
        frameBaseSupportType: existingState.frameBaseSupportType,
        loadKN: existingState.loadKN,
        loadType: existingState.loadType,
        loadPosition: existingState.loadPosition,
        loadPositionM: existingState.loadPositionM,
      })
    : '{}';

  const prompt = locale === 'zh'
    ? [
        '你是结构建模参数提取器。',
        '从用户输入里提取结构草模参数。仅返回一个 JSON 对象，不要 markdown、不要解释。',
        '必须符合以下输出约束：',
        '- 顶层只允许字段：inferredType,lengthM,spanLengthM,heightM,supportType,frameDimension,storyCount,bayCount,bayCountX,bayCountY,storyHeightsM,bayWidthsM,bayWidthsXM,bayWidthsYM,floorLoads,frameBaseSupportType,loadKN,loadType,loadPosition,loadPositionM。',
        '- 不确定字段直接省略，不要输出 null，不要输出字符串数字。',
        '- loadPositionM 表示距左端位置（m），当梁的点荷载位置明确时优先输出。',
        'inferredType 仅用于已覆盖模板（beam|truss|portal-frame|double-span-beam|frame）；其他任意结构请用 unknown，并尽量提取几何与荷载关键信息。',
        '数值统一单位：m, kN。不存在的字段不要输出。',
        `已有参数：${prior}`,
        `用户输入：${message}`,
        '若已说明梁的支座/边界条件，请提取 supportType（cantilever/simply-supported/fixed-fixed/fixed-pinned）。',
        '若已说明规则框架，请提取 frameDimension（2d/3d）、storyCount、bayCount/bayCountX/bayCountY、storyHeightsM、bayWidthsM/bayWidthsXM/bayWidthsYM、floorLoads。',
        '若已给出荷载，请同时提取 loadType（point/distributed）、loadPosition，以及点荷载位置距离 loadPositionM（单位 m，可选）。',
        '输出示例：{"inferredType":"beam","lengthM":10,"supportType":"simply-supported","loadKN":10,"loadType":"point","loadPosition":"free-joint","loadPositionM":4}',
      ].join('\n')
    : [
        'You extract structural model draft parameters.',
        'Read the user request and return exactly one JSON object only, without markdown or explanations.',
        'Output constraints:',
        '- Top-level allowed fields only: inferredType,lengthM,spanLengthM,heightM,supportType,frameDimension,storyCount,bayCount,bayCountX,bayCountY,storyHeightsM,bayWidthsM,bayWidthsXM,bayWidthsYM,floorLoads,frameBaseSupportType,loadKN,loadType,loadPosition,loadPositionM.',
        '- Omit unknown fields; do not output null; keep numeric fields as numbers.',
        '- loadPositionM means offset from left end in meters and should be provided when a beam point-load location is explicit.',
        'Use inferredType for supported templates (beam|truss|portal-frame|double-span-beam|frame); for any other structure, set inferredType=unknown and still extract key geometry/load hints.',
        'Use m and kN as units. Omit fields that are not present.',
        'When beam support or boundary conditions are mentioned, also extract supportType (cantilever/simply-supported/fixed-fixed/fixed-pinned).',
        'When a regular frame is described, also extract frameDimension (2d/3d), storyCount, bayCount/bayCountX/bayCountY, storyHeightsM, bayWidthsM/bayWidthsXM/bayWidthsYM, and floorLoads.',
        'When loads are mentioned, also extract loadType (point/distributed), loadPosition, and optional point-load offset loadPositionM (m).',
        `Known parameters: ${prior}`,
        `User input: ${message}`,
        'Example output: {"inferredType":"beam","lengthM":10,"supportType":"simply-supported","loadKN":10,"loadType":"point","loadPosition":"free-joint","loadPositionM":4}',
      ].join('\n');

  try {
    const aiMessage = await llm.invoke(prompt);
    const content = typeof aiMessage.content === 'string'
      ? aiMessage.content
      : JSON.stringify(aiMessage.content);
    const parsed = parseJsonObject(content);
    if (!parsed) {
      return null;
    }

    const payload = parsed.draftPatch && typeof parsed.draftPatch === 'object'
      ? parsed.draftPatch as Record<string, unknown>
      : parsed;

    return {
      inferredType: normalizeInferredType(payload.inferredType),
      lengthM: normalizeNumber(payload.lengthM),
      spanLengthM: normalizeNumber(payload.spanLengthM),
      heightM: normalizeNumber(payload.heightM),
      supportType: normalizeSupportType(payload.supportType),
      frameDimension: normalizeFrameDimension(payload.frameDimension),
      storyCount: normalizePositiveInteger(payload.storyCount),
      bayCount: normalizePositiveInteger(payload.bayCount),
      bayCountX: normalizePositiveInteger(payload.bayCountX),
      bayCountY: normalizePositiveInteger(payload.bayCountY),
      storyHeightsM: normalizeNumberArray(payload.storyHeightsM),
      bayWidthsM: normalizeNumberArray(payload.bayWidthsM),
      bayWidthsXM: normalizeNumberArray(payload.bayWidthsXM),
      bayWidthsYM: normalizeNumberArray(payload.bayWidthsYM),
      floorLoads: normalizeFloorLoads(payload.floorLoads),
      frameBaseSupportType: normalizeFrameBaseSupportType(payload.frameBaseSupportType),
      loadKN: normalizeNumber(payload.loadKN),
      loadType: normalizeDraftLoadType(payload.loadType),
      loadPosition: normalizeDraftLoadPosition(payload.loadPosition),
      loadPositionM: normalizeDraftLoadPositionM(payload.loadPositionM),
    };
  } catch {
    return null;
  }
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

function mergeFloorLoads(existing: DraftState['floorLoads'], incoming: DraftState['floorLoads']): DraftState['floorLoads'] {
  if (!existing?.length) {
    return incoming?.length ? [...incoming].sort((a, b) => a.story - b.story) : undefined;
  }
  if (!incoming?.length) {
    return [...existing].sort((a, b) => a.story - b.story);
  }

  const merged = new Map<number, NonNullable<DraftState['floorLoads']>[number]>();

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

function normalizeInferredType(value: unknown): InferredModelType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value === 'beam' || value === 'truss' || value === 'portal-frame' || value === 'double-span-beam' || value === 'frame' || value === 'unknown') {
    return value;
  }
  return undefined;
}

function normalizeFrameDimension(value: unknown): DraftState['frameDimension'] | undefined {
  return value === '2d' || value === '3d' ? value : undefined;
}

function normalizeFrameBaseSupportType(value: unknown): DraftState['frameBaseSupportType'] | undefined {
  return value === 'fixed' || value === 'pinned' ? value : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = normalizeNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : undefined;
}

function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((item) => normalizeNumber(item))
    .filter((item): item is number => item !== undefined && item > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFloorLoads(value: unknown): DraftState['floorLoads'] | undefined {
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
  const filtered = normalized.filter((item) => item !== null) as NonNullable<DraftState['floorLoads']>;
  return filtered.length > 0 ? filtered : undefined;
}

function normalizeSupportType(value: unknown): DraftSupportType | undefined {
  if (value === 'cantilever' || value === 'simply-supported' || value === 'fixed-fixed' || value === 'fixed-pinned') {
    return value;
  }
  return undefined;
}

function normalizeDraftLoadType(value: unknown): DraftLoadType | undefined {
  if (value === 'point' || value === 'distributed') {
    return value;
  }
  return undefined;
}

function normalizeDraftLoadPosition(value: unknown): DraftLoadPosition | undefined {
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

function normalizeDraftLoadPositionM(value: unknown): number | undefined {
  const parsed = normalizeNumber(value);
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return tryParseJson(fenced[1]);
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return tryParseJson(trimmed.slice(first, last + 1));
  }
  return null;
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
