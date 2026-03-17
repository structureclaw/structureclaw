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
  return state;
}

export function computeNoSkillMissingFields(state: DraftState): string[] {
  if (state.lengthM !== undefined || state.spanLengthM !== undefined || state.storyCount !== undefined || state.storyHeightsM?.length) {
    return ['可计算结构模型JSON（或补充边界、材料、截面、荷载与组合）'];
  }
  return ['可计算结构模型JSON，或完整自然语言结构描述（几何、边界、材料、截面、荷载、组合）'];
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
        '除非用户明确指定模板，请保持 inferredType=unknown。',
        '数值统一单位：m, kN。不存在的字段不要输出。',
        `已有参数：${prior}`,
        `用户输入：${message}`,
        '若已说明几何、边界、材料、截面、荷载、组合，请按字段提取。',
        '输出示例：{"inferredType":"unknown","lengthM":10,"loadKN":10}',
      ].join('\n')
    : [
        'You extract structural model draft parameters.',
        'Read the user request and return exactly one JSON object only, without markdown or explanations.',
        'Output constraints:',
        '- Top-level allowed fields only: inferredType,lengthM,spanLengthM,heightM,supportType,frameDimension,storyCount,bayCount,bayCountX,bayCountY,storyHeightsM,bayWidthsM,bayWidthsXM,bayWidthsYM,floorLoads,frameBaseSupportType,loadKN,loadType,loadPosition,loadPositionM.',
        '- Omit unknown fields; do not output null; keep numeric fields as numbers.',
        '- loadPositionM means offset from left end in meters and should be provided when a beam point-load location is explicit.',
        'Keep inferredType=unknown unless user explicitly requests a known template.',
        'Use m and kN as units. Omit fields that are not present.',
        'Extract geometry, boundary, material, section, load, and combination hints when available.',
        `Known parameters: ${prior}`,
        `User input: ${message}`,
        'Example output: {"inferredType":"unknown","lengthM":10,"loadKN":10}',
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
