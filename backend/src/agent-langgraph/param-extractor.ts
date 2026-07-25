/**
 * Helper for extracting structural engineering parameters from user messages.
 *
 * The extraction logic is driven by the skill manifest and draft-stage
 * markdown. Keep this as a direct LLM call instead of a nested ReAct agent:
 * some OpenAI-compatible providers reject the nested agent's reconstructed
 * internal messages with "role information cannot be empty".
 */
import {
  createChatModel,
  extractLlmTokenUsage,
  getReasoningContentLength,
  type LlmTokenUsage,
} from '../utils/llm.js';
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
      '  "geometry": { "lengthM": number, "heightM": number, "mezzanineHeightM": number, "mezzanineLengthM": number, "spanLengthsM": number[], "storyHeightsM": number[], "bayWidthsM": number[], "bayWidthsXM": number[], "bayWidthsYM": number[] },',
      '  "topology": { "nodes": [{ "id": string, "x": number, "y": number, "z": number, "restraints": boolean[6] }], "members": [{ "id": string, "nodes": [string, string] }] },',
      '  // restraints 顺序严格为 [ux,uy,uz,rx,ry,rz]，true 表示约束。X-Z 平面铰支座为 [true,true,true,false,false,false]，沿全局 X 向可滑动的滚动支座为 [false,true,true,false,false,false]。',
      '  "material": { "family": "steel|concrete|composite|timber|masonry|generic", "grade": string, "rebarGrade": string },',
      '  "sections": { "beam": string, "column": string, "member": string },',
      '  "boundary": { "supportType": "cantilever|simply-supported|fixed-fixed|fixed-pinned", "frameBaseSupportType": "fixed|pinned", "supportPositionsM": number[] },',
      '  "loads": [',
      '    { "kind": "point|line|area|nodal|distributed", "magnitude": number, "unit": "kN|kN/m|kN/m2", "direction": "gravity|globalX|globalY|globalZ", "target": string, "location": { "xM": number, "spanIndex": number, "story": number, "nodeRole": string }, "caseId": string, "caseType": "dead|live|wind|seismic|other" } // spanIndex 和 story 均从 1 开始；明确给出工况时必须保留 caseId/caseType',
      '  ],',
      '  "seismicMemberEvidence": { "byElementId": { "E1": { "seismicCapacity": object, "capacityDesign": object, "strongShearWeakBending": object, "shearCompression": object, "jointCore": object, "wallData": object, "boundaryElement": object, "steelSeismicDetailing": object } } },',
      '  "wind": { "basicPressureKNM2": number, "terrainRoughness": "A|B|C|D", "shapeFactor": number, "heightVariationFactor": number },',
      '  "analysis": { "type": "static|dynamic|seismic|nonlinear", "engineTarget": "opensees|pkpm|yjk", "loadCombinations": [{ "id": string, "factors": { "<loadCaseId>": number } }] }',
      '} },',
      '"draftIssues": [',
      '  { "field": string, "value": any, "severity": "invalid|ambiguous|unrealistic|conflict", "reason": string, "question": string }',
      '],',
      '"skillState": {',
      '  "invalidDraftFields": string[],',
      '  "seismicWorkflow": {',
      '    "methodPreference": "auto|response_spectrum|time_history|pushover|elastic_plastic_time_history",',
      '    "designBasis": { "codes": string[], "region": string, "regionCode": string, "siteSeismic": { "intensity": number, "accelerationG": number, "designGroup": string, "siteCategory": string }, "groundMotionZonation": { "source": string, "records": object[] } },',
      '    "designRequirements": { "fortificationCategory": string, "seismicGrade": number, "irregularity": string, "supplementaryTimeHistory": boolean },',
      '    "structure": { "heightM": number, "storyCount": number },',
      '    "groundMotionSet": { "source": "uploaded|builtin_artificial|local_catalog", "requiredCount": number, "records": object[], "catalogIds": string[], "localCatalog": { "records": object[] }, "selectionCriteria": object, "scaleFactorLimit": number },',
      '    "memberEvidence": { "byElementId": { "E1": { "seismicCapacity": object, "capacityDesign": object, "strongShearWeakBending": object, "shearCompression": object, "jointCore": object, "wallData": object, "boundaryElement": object, "steelSeismicDetailing": object } } },',
      '    "responseSpectrum": { "modalCombination": "cqc|srss" },',
      '    "directions": ["x","y"]',
      '  }',
      '}',
    ].join('\n');
  }
  return [
    'Prefer a field named engineeringDraft whose value has this shape:',
    '{ "engineeringDraft":',
    '{',
    '  "structureType": "beam|column|truss|portal-frame|steel-frame|concrete-frame",',
    '  "geometry": { "lengthM": number, "heightM": number, "mezzanineHeightM": number, "mezzanineLengthM": number, "spanLengthsM": number[], "storyHeightsM": number[], "bayWidthsM": number[], "bayWidthsXM": number[], "bayWidthsYM": number[] },',
    '  "topology": { "nodes": [{ "id": string, "x": number, "y": number, "z": number, "restraints": boolean[6] }], "members": [{ "id": string, "nodes": [string, string] }] },',
    '  // restraints are exactly [ux,uy,uz,rx,ry,rz], where true means restrained. In an X-Z model, a pin is [true,true,true,false,false,false] and a roller free in global X is [false,true,true,false,false,false].',
      '  "material": { "family": "steel|concrete|composite|timber|masonry|generic", "grade": string, "rebarGrade": string },',
      '  "sections": { "beam": string, "column": string, "member": string },',
      '  "boundary": { "supportType": "cantilever|simply-supported|fixed-fixed|fixed-pinned", "frameBaseSupportType": "fixed|pinned", "supportPositionsM": number[] },',
      '  "loads": [',
      '    { "kind": "point|line|area|nodal|distributed", "magnitude": number, "unit": "kN|kN/m|kN/m2", "direction": "gravity|globalX|globalY|globalZ", "target": string, "location": { "xM": number, "spanIndex": number, "story": number, "nodeRole": string }, "caseId": string, "caseType": "dead|live|wind|seismic|other" } // spanIndex and story are 1-based; preserve caseId/caseType whenever a load case is explicit',
      '  ],',
      '  "seismicMemberEvidence": { "byElementId": { "E1": { "seismicCapacity": object, "capacityDesign": object, "strongShearWeakBending": object, "shearCompression": object, "jointCore": object, "wallData": object, "boundaryElement": object, "steelSeismicDetailing": object } } },',
      '  "wind": { "basicPressureKNM2": number, "terrainRoughness": "A|B|C|D", "shapeFactor": number, "heightVariationFactor": number },',
      '  "analysis": { "type": "static|dynamic|seismic|nonlinear", "engineTarget": "opensees|pkpm|yjk", "loadCombinations": [{ "id": string, "factors": { "<loadCaseId>": number } }] }',
    '} },',
    '"draftIssues": [',
    '  { "field": string, "value": any, "severity": "invalid|ambiguous|unrealistic|conflict", "reason": string, "question": string }',
    '],',
    '"skillState": {',
    '  "invalidDraftFields": string[],',
    '  "seismicWorkflow": {',
    '    "methodPreference": "auto|response_spectrum|time_history|pushover|elastic_plastic_time_history",',
    '    "designBasis": { "codes": string[], "region": string, "regionCode": string, "siteSeismic": { "intensity": number, "accelerationG": number, "designGroup": string, "siteCategory": string }, "groundMotionZonation": { "source": string, "records": object[] } },',
    '    "designRequirements": { "fortificationCategory": string, "seismicGrade": number, "irregularity": string, "supplementaryTimeHistory": boolean },',
      '    "structure": { "heightM": number, "storyCount": number },',
      '    "groundMotionSet": { "source": "uploaded|builtin_artificial|local_catalog", "requiredCount": number, "records": object[], "catalogIds": string[], "localCatalog": { "records": object[] }, "selectionCriteria": object, "scaleFactorLimit": number },',
      '    "memberEvidence": { "byElementId": { "E1": { "seismicCapacity": object, "capacityDesign": object, "strongShearWeakBending": object, "shearCompression": object, "jointCore": object, "wallData": object, "boundaryElement": object, "steelSeismicDetailing": object } } },',
      '    "responseSpectrum": { "modalCombination": "cqc|srss" },',
      '    "directions": ["x","y"]',
      '  }',
    '}',
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
      '- 已有 draftState 由系统保留；本轮 JSON 只输出用户最新消息明确新增或更正的字段，不要重复未改变的旧参数',
      '- 已有 draftState 只代表已接受的参数；如果当前用户消息是在回答追问或更正缺失/无效字段，必须输出新给出的字段，不要重复旧的缺参或无效诊断',
      '- 不确定时省略字段，不要猜测',
      '- 不得补写用户未提供的荷载单位或荷载种类；若荷载数值没有单位，或“楼面荷载”等表述无法区分总力、线荷载或面荷载，必须省略该荷载，输出 draftIssues，并把对应荷载字段写入 skillState.invalidDraftFields，要求用户确认单位和荷载种类',
      '- 如果用户给出数学上无效的几何尺寸、荷载符号/单位/位置含义不明确，或要求彼此矛盾，不要把相关值写入 engineeringDraft/draftPatch；输出 draftIssues，并把对应字段名写入 skillState.invalidDraftFields。数值仅仅非常规或很大/很小并不自动构成无效输入',
      '- 负号可能表示方向或吸力时，必须用 draftIssues 标记为 ambiguous 并追问；只有方向明确且数值大小为正时，才写入荷载 magnitude',
      '- 对框架楼面线荷载/面荷载（如 kN/m、kN/m2），如果已有层数和跨度信息，应输出 engineeringDraft.loads 中的 line/area 荷载；不要因为它不是总 kN 就追问',
      '- 对“基本风压 / basic wind pressure”输出 engineeringDraft.wind.basicPressureKNM2；不要把风压当作竖向楼面荷载',
      '- 当用户提出中国抗震、反应谱、时程、Pushover、弹塑性时程、设防烈度、设计地震分组、场地类别或地震波选择等抗震设计意图时，必须基于整句语义输出 skillState.seismicWorkflow；方法选择只允许来自语义理解后的结构化字段，不要用关键词或正则匹配决定 response_spectrum/time_history/pushover/elastic_plastic_time_history',
      '- 如果用户提供 GB18306 区划表、地震波文件或本地地震波库，只把已提供的数据映射到 seismicWorkflow.designBasis.groundMotionZonation 或 seismicWorkflow.groundMotionSet；不要根据城市名或自然语言自行编造烈度、分组、特征周期或地震波记录',
      '- 如果用户提供构件抗震承载力、gammaRE、强剪弱弯、剪压比、节点核芯区、抗震墙边缘构件、钢构件长细比或宽厚比证据，必须保留为结构化 seismicMemberEvidence 或 seismicWorkflow.memberEvidence；不要把证据只写成自然语言备注，也不要由 LLM 判断条文通过或失败',
      '- 嵌套数组字段必须输出完整对象；例如 floorLoads 的每一项都必须包含 story',
      '- 如果用户明确给出多个荷载，每个荷载都必须作为 engineeringDraft.loads 的独立条目输出，不要合并或丢弃集中力/节点力',
      '- 如果用户明确区分荷载工况，必须在每个荷载中保留 caseId 和 caseType；如果明确给出荷载组合，必须原样输出 engineeringDraft.analysis.loadCombinations，不得把不同工况预先合并',
      '- 源面荷载及其按受荷宽度折算得到的线荷载不是两个独立荷载；若用户要求采用折算结果，只输出折算后的线荷载，除非用户明确要求两者叠加',
      '- 如果用户或附件摘要明确给出节点坐标和构件连接关系，必须原样输出 engineeringDraft.topology，不要用规则化拓扑替换',
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
    '- Existing draftState values are preserved by the system; output only fields explicitly added or corrected by the latest user message, without repeating unchanged prior parameters',
    '- Treat the existing draftState as accepted parameters only; if the current user message answers a clarification question or corrects a missing/invalid field, output the newly provided field instead of repeating the old missing/invalid diagnostic',
      '- Omit fields you are unsure about — do NOT guess',
      '- Never supply a load unit or load kind that the user did not provide; if a load magnitude has no unit, or wording such as "floor load" does not distinguish total force, line load, or area load, omit that load, output draftIssues, put the corresponding load field in skillState.invalidDraftFields, and ask the user to confirm the unit and load kind',
      '- If geometry is mathematically invalid, a load sign/unit/location is ambiguous, or requirements contradict one another, do NOT write the affected value into engineeringDraft/draftPatch; output draftIssues and put the corresponding field name in skillState.invalidDraftFields. An unusual, large, or small value is not invalid by magnitude alone',
    '- If a negative sign may mean direction or suction/uplift, mark it as an ambiguous draftIssue and ask for clarification; only write a load magnitude when the direction is clear and the magnitude is positive',
    '- For frame floor line/area loads such as kN/m or kN/m2, output line/area entries in engineeringDraft.loads when story and span geometry are available; do not ask for total kN just because the user provided intensity units',
    '- For basic wind pressure, output engineeringDraft.wind.basicPressureKNM2; do not treat wind pressure as a vertical floor load',
    '- When the user asks for China seismic design, response spectrum, time history, pushover, elastic-plastic time history, seismic intensity, design group, site class, or ground-motion selection, output skillState.seismicWorkflow from whole-message semantic understanding; method selection may only come from structured semantic fields, never keyword or regex matching',
    '- If the user provides a GB18306 zonation table, ground-motion files, or a local ground-motion catalog, map only the provided data into seismicWorkflow.designBasis.groundMotionZonation or seismicWorkflow.groundMotionSet; do not invent intensity, design group, characteristic period, or ground-motion records from city names or prose',
    '- If the user provides member seismic capacity, gammaRE, capacity-design, strong-shear weak-bending, shear-compression, joint-core, seismic-wall boundary-element, steel slenderness, or steel width-thickness evidence, preserve it as structured seismicMemberEvidence or seismicWorkflow.memberEvidence; do not leave it only as prose and do not have the LLM decide clause pass/fail status',
      '- Nested array fields must contain complete objects; for example each floorLoads item must include story',
      '- If the user explicitly gives multiple loads, output each load as its own engineeringDraft.loads entry; do not merge or drop point/nodal loads',
      '- If the user explicitly distinguishes load cases, preserve caseId and caseType on every load; if a load combination is explicit, reproduce it in engineeringDraft.analysis.loadCombinations without pre-combining the cases',
      '- A source area load and the line load derived from it by tributary width are not independent loads; when the user says to apply the converted result, emit only the derived line load unless the user explicitly requires both to be superimposed',
    '- If the user or attachment summary explicitly gives node coordinates and member connectivity, preserve them in engineeringDraft.topology instead of replacing them with a regularized topology',
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
      '- 已有 draftState 由系统保留；本轮 JSON 只输出用户最新回答明确补充或更正的重点字段',
      '- 如果用户最新回答明确提供了本轮重点字段，必须输出该字段对应的 engineeringDraft/draftPatch',
      '- 不要把旧的缺参诊断或无效诊断重复输出为本轮结果',
      '- 不确定时省略字段，不要猜测',
      '- 若本轮荷载数值仍没有单位，或仍无法区分总力、线荷载或面荷载，不得自行补写；输出 draftIssues 和 skillState.invalidDraftFields，并继续要求确认单位和荷载种类',
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
    '- Existing draftState values are preserved by the system; output only focus fields explicitly supplied or corrected by the latest user answer',
    '- If the latest user answer clearly provides a focus field, you MUST output the corresponding engineeringDraft/draftPatch field',
    '- Do not repeat old missing/invalid diagnostics as the result for this turn',
    '- Omit fields you are unsure about; do not guess',
    '- If the latest load magnitude still has no unit, or still does not distinguish total force, line load, or area load, do not supply one; output draftIssues and skillState.invalidDraftFields and continue asking for the unit and load kind',
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
  /** Benchmark-only: do not replace LLM failures or unusable output with handler extraction. */
  requireLlmResult?: boolean;
  /** Cancels an in-flight extraction when the enclosing agent run is aborted. */
  signal?: AbortSignal;
  /** Records provider usage for benchmark efficiency metrics. */
  onUsage?: (usage: LlmTokenUsage) => void;
  /** Test injection; production callers use the configured chat model. */
  llm?: {
    invoke: (
      prompt: string,
      options?: { signal?: AbortSignal },
    ) => Promise<{
      content: unknown;
      response_metadata?: Record<string, unknown>;
      usage_metadata?: Record<string, unknown>;
    }>;
  } | null;
}

export async function invokeParamExtractor(
  input: ParamExtractorInput,
): Promise<Record<string, unknown> | null> {
  const log = input.traceLogger ?? rootLogger;
  const pluginId = input.plugin.id;
  const locale = input.locale;
  log.info({ pluginId, locale }, 'param extractor started');

  const llm = input.llm === undefined ? createChatModel(0) : input.llm;
  if (!llm) {
    if (input.requireLlmResult) {
      throw new Error('LLM_PARAM_EXTRACTOR_CONFIGURATION_ERROR: no LLM is configured');
    }
    return null;
  }

  const start = Date.now();
  const prompt = buildParamExtractorPrompt(
    input.locale,
    input.existingState,
    input.plugin,
    input.message,
    input.focusFields,
  );

  let result: {
    content: unknown;
    response_metadata?: Record<string, unknown>;
    usage_metadata?: Record<string, unknown>;
  };
  try {
    result = await llm.invoke(prompt, { signal: input.signal });
  } catch (error) {
    log.warn(
      {
        pluginId,
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
      input.requireLlmResult
        ? 'param extractor LLM failed in benchmark LLM-only mode'
        : 'param extractor LLM failed; falling back to handler extraction',
    );
    if (input.requireLlmResult) {
      throw new Error(
        `LLM_PARAM_EXTRACTOR_INFRASTRUCTURE_ERROR: network error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    return null;
  }

  const usage = extractLlmTokenUsage(result);
  if (usage) input.onUsage?.(usage);
  const content = typeof result.content === 'string'
    ? result.content
    : JSON.stringify(result.content);
  const patch = parseDraftPatchFromContent(content);
  const rawFinishReason = result.response_metadata?.finish_reason
    ?? result.response_metadata?.stop_reason;
  const finishReason = typeof rawFinishReason === 'string' ? rawFinishReason : undefined;
  const reasoningContentLength = getReasoningContentLength(result);
  log.debug(
    {
      pluginId,
      durationMs: Date.now() - start,
      hasDraftPatch: !!patch,
      finishReason,
      contentLength: content.length,
      reasoningContentLength,
    },
    'param extractor completed',
  );
  if (!patch && input.requireLlmResult) {
    throw new Error(
      'LLM_PARAM_EXTRACTOR_INVALID_OUTPUT: response was not a usable JSON draft patch; '
      + `finishReason=${finishReason ?? 'unknown'}; contentLength=${content.length}; `
      + `reasoningContentLength=${reasoningContentLength}`,
    );
  }
  return patch;
}
