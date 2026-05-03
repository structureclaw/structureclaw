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
    guidanceByStage: plugin.markdownByStage,
    draftStageGuidance:
      plugin.markdownByStage.draft
      || plugin.markdownByStage.intent
      || '(no draft-stage guidance)',
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildParamExtractorPrompt(
  locale: 'zh' | 'en',
  existingState: DraftState | undefined,
  plugin: AgentSkillPlugin,
  message: string,
): string {
  const stateJson = JSON.stringify(existingState ?? {}, null, 2);
  const skillInfoJson = JSON.stringify(buildSkillInfo(plugin), null, 2);

  if (locale === 'zh') {
    return [
      '你是结构工程参数提取专家。',
      '',
      '当前结构技能参数说明：',
      skillInfoJson,
      '',
      '根据上面的参数说明，从用户消息中提取工程参数，输出一个 JSON 对象。',
      '',
      '规则：',
      '- 参数字段名必须与当前结构技能参数说明一致',
      '- 长度单位 m，力单位 kN，分布荷载 kN/m',
      '- 保留已有 draftState 中的所有参数值，补充新提取的值',
      '- 不确定时省略字段，不要猜测',
      '- 嵌套数组字段必须输出完整对象；例如 floorLoads 的每一项都必须包含 story',
      '- 不输出元数据字段（updatedAt, skillId, structuralTypeKey, supportLevel, coordinateSemantics, supportNote）',
      '- 可以输出 draftPatch 对象，也可以直接输出参数对象；不要 markdown 包装或解释',
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
    '',
    'Rules:',
    '- Parameter field names MUST match the current structural skill parameter guidance',
    '- Length in meters, force in kN, distributed load in kN/m',
    '- Preserve ALL existing draftState parameter values, add newly extracted ones',
    '- Omit fields you are unsure about — do NOT guess',
    '- Nested array fields must contain complete objects; for example each floorLoads item must include story',
    '- Do NOT output metadata fields (updatedAt, skillId, structuralTypeKey, supportLevel, coordinateSemantics, supportNote)',
    '- You may output a draftPatch object or the parameter object directly; no markdown fences, no explanations',
    '',
    `Existing draftState:\n${stateJson}`,
    '',
    `User message:\n${message}`,
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

function unwrapDraftPatch(parsed: Record<string, unknown>): Record<string, unknown> {
  const draftPatch = parsed.draftPatch;
  if (draftPatch && typeof draftPatch === 'object' && !Array.isArray(draftPatch)) {
    return draftPatch as Record<string, unknown>;
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
  const prompt = buildParamExtractorPrompt(input.locale, input.existingState, input.plugin, input.message);

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
