/**
 * Helper for extracting structural engineering parameters from user messages.
 *
 * The extraction logic is driven by the skill manifest and draft-stage
 * markdown. Keep this as a direct LLM call instead of a nested ReAct agent:
 * some OpenAI-compatible providers reject the nested agent's reconstructed
 * internal messages with "role information cannot be empty".
 */
import { createChatModel } from '../utils/llm.js';
import { logger as rootLogger } from '../utils/agent-logger.js';
import type { Logger } from 'pino';
import type { AgentSkillPlugin, DraftState } from '../agent-runtime/types.js';

// ---------------------------------------------------------------------------
// Skill context
// ---------------------------------------------------------------------------

function buildSkillInfo(plugin: AgentSkillPlugin): Record<string, unknown> {
  return {
    skillId: plugin.id,
    name: plugin.name,
    description: plugin.description,
    stages: plugin.stages,
    structureType: plugin.structureType,
    draftStageGuidance: getDraftStageGuidance(plugin),
  };
}

function getDraftStageGuidance(plugin: AgentSkillPlugin): string {
  return plugin.markdownByStage.draft
    || plugin.markdownByStage.intent
    || '(no draft-stage guidance)';
}

function isSerializedUndefined(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.lc === 2 && record.type === 'undefined' && Object.keys(record).length === 2;
}

function cleanPromptState(value: unknown, keyPath: string[] = []): unknown {
  if (value === undefined || isSerializedUndefined(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const cleanedArray = value
      .map((item) => cleanPromptState(item, keyPath))
      .filter((item) => item !== undefined);
    return cleanedArray.length > 0 ? cleanedArray : undefined;
  }
  if (value && typeof value === 'object') {
    const key = keyPath[keyPath.length - 1];
    if (key === 'draftIssues') {
      return undefined;
    }
    const metadataKeys = new Set([
      'updatedAt',
      'skillId',
      'structuralTypeKey',
      'supportLevel',
      'supportNote',
      'coordinateSemantics',
      'extractionSource',
    ]);
    const cleanedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([entryKey]) => !metadataKeys.has(entryKey))
      .filter(([entryKey]) => !(key === 'skillState' && (
        entryKey === 'invalidDraftFields'
        || entryKey === 'engineeringDraft'
      )))
      .map(([entryKey, item]) => [entryKey, cleanPromptState(item, [...keyPath, entryKey])] as const)
      .filter(([, item]) => item !== undefined);
    if (cleanedEntries.length === 0) {
      return undefined;
    }
    return Object.fromEntries(cleanedEntries);
  }
  return value;
}

function engineeringDraftSchemaDescription(locale: 'zh' | 'en'): string {
  if (locale === 'zh') {
    return [
      '优先输出名为 engineeringDraft 的字段，字段值结构如下：',
      '{ "engineeringDraft":',
      '{',
      '  "structureType": "beam|column|truss|portal-frame|steel-frame|concrete-frame",',
      '  "geometry": { "lengthM": number, "heightM": number, "spanLengthsM": number[], "storyHeightsM": number[], "bayWidthsM": number[], "bayWidthsXM": number[], "bayWidthsYM": number[] },',
      '  "material": { "family": "steel|concrete|composite|timber|masonry|generic", "grade": string, "rebarGrade": string },',
      '  "sections": { "beam": string, "column": string, "member": string },',
      '  "boundary": { "supportType": "cantilever|simply-supported|fixed-fixed|fixed-pinned", "frameBaseSupportType": "fixed|pinned", "supportPositionsM": number[] },',
      '  "loads": [',
      '    { "kind": "point|line|area|nodal|distributed", "magnitude": number, "unit": "kN|kN/m|kN/m2", "direction": "gravity|globalX|globalY|globalZ", "target": string, "location": { "xM": number, "spanIndex": number, "nodeRole": string } }',
      '  ],',
      '  "wind": { "basicPressureKNM2": number, "terrainRoughness": "A|B|C|D", "shapeFactor": number, "heightVariationFactor": number },',
      '  "analysis": { "type": "static|dynamic|seismic|nonlinear", "engineTarget": "opensees|pkpm|yjk" }',
      '} },',
      '"draftIssues": [',
      '  { "field": string, "value": any, "severity": "invalid|ambiguous|unrealistic|conflict", "reason": string, "question": string }',
      '],',
      '"skillState": { "invalidDraftFields": string[] }',
    ].join('\n');
  }
  return [
    'Prefer a field named engineeringDraft whose value has this shape:',
    '{ "engineeringDraft":',
    '{',
    '  "structureType": "beam|column|truss|portal-frame|steel-frame|concrete-frame",',
    '  "geometry": { "lengthM": number, "heightM": number, "spanLengthsM": number[], "storyHeightsM": number[], "bayWidthsM": number[], "bayWidthsXM": number[], "bayWidthsYM": number[] },',
    '  "material": { "family": "steel|concrete|composite|timber|masonry|generic", "grade": string, "rebarGrade": string },',
    '  "sections": { "beam": string, "column": string, "member": string },',
    '  "boundary": { "supportType": "cantilever|simply-supported|fixed-fixed|fixed-pinned", "frameBaseSupportType": "fixed|pinned", "supportPositionsM": number[] },',
      '  "loads": [',
      '    { "kind": "point|line|area|nodal|distributed", "magnitude": number, "unit": "kN|kN/m|kN/m2", "direction": "gravity|globalX|globalY|globalZ", "target": string, "location": { "xM": number, "spanIndex": number, "nodeRole": string } }',
      '  ],',
      '  "wind": { "basicPressureKNM2": number, "terrainRoughness": "A|B|C|D", "shapeFactor": number, "heightVariationFactor": number },',
      '  "analysis": { "type": "static|dynamic|seismic|nonlinear", "engineTarget": "opensees|pkpm|yjk" }',
    '} },',
    '"draftIssues": [',
    '  { "field": string, "value": any, "severity": "invalid|ambiguous|unrealistic|conflict", "reason": string, "question": string }',
    '],',
    '"skillState": { "invalidDraftFields": string[] }',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildParamExtractorPrompt(
  locale: 'zh' | 'en',
  existingState: DraftState | undefined,
  plugin: AgentSkillPlugin,
  message: string,
  focusFields: string[] = [],
): string {
  if (focusFields.length > 0) {
    return buildFocusedParamExtractorPrompt(locale, existingState, plugin, message, focusFields);
  }

  const stateJson = JSON.stringify(cleanPromptState(existingState) ?? {}, null, 2);
  const skillInfoJson = JSON.stringify(buildSkillInfo(plugin), null, 2);
  const draftStageGuidance = getDraftStageGuidance(plugin);

  if (locale === 'zh') {
    return [
      '你是结构工程参数提取专家。',
      '',
      '当前结构技能参数说明：',
      skillInfoJson,
      '',
      '根据上面的参数说明，从用户消息中提取工程参数，输出一个 JSON 对象。',
      engineeringDraftSchemaDescription(locale),
      '',
      '规则：',
      '- 优先输出 engineeringDraft；为了兼容旧链路，也可以同时输出 draftPatch',
      '- draftPatch 字段名必须与当前结构技能参数说明一致',
      '- 长度单位 m，力单位 kN，线荷载 kN/m，面荷载 kN/m2',
      '- 保留已有 draftState 中的所有参数值，补充新提取的值',
      '- 已有 draftState 只代表已接受的参数；如果当前用户消息是在回答追问或更正缺失/无效字段，必须输出新给出的字段，不要重复旧的缺参或无效诊断',
      '- 不确定时省略字段，不要猜测',
      '- 如果用户明确给出非正几何尺寸、非正荷载大小、语义矛盾或需要工程判断的异常值，不要把该值写入 engineeringDraft/draftPatch；输出 draftIssues，并把对应字段名写入 skillState.invalidDraftFields',
      '- 负号可能表示方向或吸力时，必须用 draftIssues 标记为 ambiguous 并追问；只有方向明确且数值大小为正时，才写入荷载 magnitude',
      '- 对框架楼面线荷载/面荷载（如 kN/m、kN/m2），如果已有层数和跨度信息，应输出 engineeringDraft.loads 中的 line/area 荷载；不要因为它不是总 kN 就追问',
      '- 对“基本风压 / basic wind pressure”输出 engineeringDraft.wind.basicPressureKNM2；不要把风压当作竖向楼面荷载',
      '- 嵌套数组字段必须输出完整对象；例如 floorLoads 的每一项都必须包含 story',
      '- 如果用户明确给出多个荷载，每个荷载都必须作为 engineeringDraft.loads 的独立条目输出，不要合并或丢弃集中力/节点力',
      '- 不输出元数据字段（updatedAt, skillId, structuralTypeKey, supportLevel, coordinateSemantics, supportNote）',
      '- 不要为了补齐字段而猜测未明确给出的工程参数',
      '- 不要 markdown 包装或解释',
      '',
      '当前 draft 阶段重点说明：',
      draftStageGuidance,
      '',
      `已有 draftState:\n${stateJson}`,
      '',
      `用户消息:\n${message}`,
    ].join('\n');
  }

  return [
    'You are a structural engineering parameter extraction specialist.',
    '',
    'Current structural skill parameter guidance:',
    skillInfoJson,
    '',
    'Extract engineering parameters from the user message based on the guidance above, and output a JSON object.',
    engineeringDraftSchemaDescription(locale),
    '',
    'Rules:',
    '- Prefer engineeringDraft; you may also include draftPatch for legacy compatibility',
    '- draftPatch field names MUST match the current structural skill parameter guidance',
    '- Length in meters, force in kN, line load in kN/m, area load in kN/m2',
    '- Preserve ALL existing draftState parameter values, add newly extracted ones',
    '- Treat the existing draftState as accepted parameters only; if the current user message answers a clarification question or corrects a missing/invalid field, output the newly provided field instead of repeating the old missing/invalid diagnostic',
    '- Omit fields you are unsure about — do NOT guess',
    '- If the user gives non-positive geometry dimensions, non-positive load magnitudes, semantic conflicts, or values that need engineering judgment, do NOT write that value into engineeringDraft/draftPatch; output draftIssues and put the corresponding field name in skillState.invalidDraftFields',
    '- If a negative sign may mean direction or suction/uplift, mark it as an ambiguous draftIssue and ask for clarification; only write a load magnitude when the direction is clear and the magnitude is positive',
    '- For frame floor line/area loads such as kN/m or kN/m2, output line/area entries in engineeringDraft.loads when story and span geometry are available; do not ask for total kN just because the user provided intensity units',
    '- For basic wind pressure, output engineeringDraft.wind.basicPressureKNM2; do not treat wind pressure as a vertical floor load',
    '- Nested array fields must contain complete objects; for example each floorLoads item must include story',
    '- If the user explicitly gives multiple loads, output each load as its own engineeringDraft.loads entry; do not merge or drop point/nodal loads',
    '- Do NOT output metadata fields (updatedAt, skillId, structuralTypeKey, supportLevel, coordinateSemantics, supportNote)',
    '- Do not guess engineering parameters that are not clear from the message',
    '- No markdown fences, no explanations',
    '',
    'Current draft-stage guidance:',
    draftStageGuidance,
    '',
    `Existing draftState:\n${stateJson}`,
    '',
    `User message:\n${message}`,
  ].join('\n');
}

function buildFocusedParamExtractorPrompt(
  locale: 'zh' | 'en',
  existingState: DraftState | undefined,
  plugin: AgentSkillPlugin,
  message: string,
  focusFields: string[],
): string {
  const stateJson = JSON.stringify(cleanPromptState(existingState) ?? {}, null, 2);
  const skillInfoJson = JSON.stringify(buildSkillInfo(plugin), null, 2);
  const draftStageGuidance = getDraftStageGuidance(plugin);
  const focusJson = JSON.stringify(focusFields);

  if (locale === 'zh') {
    return [
      '你是结构工程参数提取专家，正在处理多轮澄清回答。',
      '',
      '目标：只从用户最新回答中补齐或更正指定缺失字段；不要重新生成整套模型，也不要只重复已有参数。',
      '',
      '当前结构技能：',
      skillInfoJson,
      '',
      '当前 draft 阶段重点说明：',
      draftStageGuidance,
      '',
      `本轮重点字段：${focusJson}`,
      '',
      '输出一个 JSON 对象。优先输出 engineeringDraft；为了兼容旧链路，也可以同时输出 draftPatch。',
      engineeringDraftSchemaDescription(locale),
      '',
      '规则：',
      '- 保留已有 draftState 中的所有参数值，补充用户最新回答明确给出的字段',
      '- 如果用户最新回答明确提供了本轮重点字段，必须输出该字段对应的 engineeringDraft/draftPatch',
      '- 不要把旧的缺参诊断或无效诊断重复输出为本轮结果',
      '- 不确定时省略字段，不要猜测',
      '- 不要 markdown 包装或解释',
      '',
      `已有 draftState:\n${stateJson}`,
      '',
      `用户最新回答:\n${message}`,
    ].join('\n');
  }

  return [
    'You are a structural engineering parameter extraction specialist handling a multi-turn clarification answer.',
    '',
    'Goal: fill or correct only the specified missing fields from the latest user answer; do not regenerate the whole model and do not merely repeat existing parameters.',
    '',
    'Current structural skill:',
    skillInfoJson,
    '',
    'Current draft-stage guidance:',
    draftStageGuidance,
    '',
    `Focus fields for this turn: ${focusJson}`,
    '',
    'Output a JSON object. Prefer engineeringDraft; you may also include draftPatch for legacy compatibility.',
    engineeringDraftSchemaDescription(locale),
    '',
    'Rules:',
    '- Preserve all existing draftState parameter values and add fields explicitly provided by the latest user answer',
    '- If the latest user answer clearly provides a focus field, you MUST output the corresponding engineeringDraft/draftPatch field',
    '- Do not repeat old missing/invalid diagnostics as the result for this turn',
    '- Omit fields you are unsure about; do not guess',
    '- No markdown fences, no explanations',
    '',
    `Existing draftState:\n${stateJson}`,
    '',
    `Latest user answer:\n${message}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// JSON parsing (reuses logic from executor.ts)
// ---------------------------------------------------------------------------

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed) return parsed;
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return tryParseJson(trimmed.slice(first, last + 1));
  }

  return null;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeTopLevelEngineeringDraft(parsed: Record<string, unknown>): boolean {
  if (isRecord(parsed.engineeringDraft) || isRecord(parsed.draftPatch)) {
    return false;
  }
  return (
    isRecord(parsed.geometry)
    || isRecord(parsed.material)
    || isRecord(parsed.sections)
    || isRecord(parsed.boundary)
    || Array.isArray(parsed.loads)
    || isRecord(parsed.analysis)
  );
}

function unwrapDraftPatch(parsed: Record<string, unknown>): Record<string, unknown> {
  const engineeringDraft = parsed.engineeringDraft;
  const draftPatch = parsed.draftPatch;
  const supplemental = {
    ...(parsed.skillState && typeof parsed.skillState === 'object' && !Array.isArray(parsed.skillState)
      ? { skillState: parsed.skillState }
      : {}),
    ...(Array.isArray(parsed.draftIssues) ? { draftIssues: parsed.draftIssues } : {}),
  };
  if (draftPatch && typeof draftPatch === 'object' && !Array.isArray(draftPatch)) {
    return {
      ...(draftPatch as Record<string, unknown>),
      ...(engineeringDraft && typeof engineeringDraft === 'object' && !Array.isArray(engineeringDraft)
        ? { engineeringDraft }
        : {}),
      ...supplemental,
    };
  }
  if (looksLikeTopLevelEngineeringDraft(parsed)) {
    return {
      ...(typeof parsed.inferredType === 'string' ? { inferredType: parsed.inferredType } : {}),
      engineeringDraft: parsed,
      ...supplemental,
    };
  }
  return parsed;
}

export function parseDraftPatchFromContent(content: string): Record<string, unknown> | null {
  const parsed = parseJsonObject(content);
  return parsed ? unwrapDraftPatch(parsed) : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParamExtractorInput {
  message: string;
  existingState: DraftState | undefined;
  locale: 'zh' | 'en';
  plugin: AgentSkillPlugin;
  focusFields?: string[];
  /** Per-request logger with traceId/conversationId. Falls back to root logger. */
  traceLogger?: Logger;
}

export async function invokeParamExtractor(
  input: ParamExtractorInput,
): Promise<Record<string, unknown> | null> {
  const log = input.traceLogger ?? rootLogger;
  const pluginId = input.plugin.id;
  const locale = input.locale;
  log.info({ pluginId, locale }, 'param extractor started');

  const llm = createChatModel(0);
  if (!llm) return null;

  const start = Date.now();
  const prompt = buildParamExtractorPrompt(
    input.locale,
    input.existingState,
    input.plugin,
    input.message,
    input.focusFields,
  );

  try {
    const result = await llm.invoke(prompt);
    const content = typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
    const patch = parseDraftPatchFromContent(content);
    log.debug({ pluginId, durationMs: Date.now() - start, hasDraftPatch: !!patch }, 'param extractor completed');
    return patch;
  } catch (error) {
    log.warn(
      {
        pluginId,
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
      'param extractor LLM failed; falling back to handler extraction',
    );
    return null;
  }
}
