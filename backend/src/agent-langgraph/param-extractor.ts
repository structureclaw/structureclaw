/**
 * Sub-agent for extracting structural engineering parameters from user messages.
 *
 * Uses `createReactAgent` with a `get_skill_parameter_info` tool so the
 * extraction logic is driven entirely by the skill manifest (draft-stage
 * markdown). No hardcoded field lists.
 */
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createChatModel } from '../utils/llm.js';
import { logger as rootLogger } from '../utils/agent-logger.js';
import type { Logger } from 'pino';
import type { AgentSkillPlugin, DraftState } from '../agent-runtime/types.js';

// ---------------------------------------------------------------------------
// Tool: get_skill_parameter_info
// ---------------------------------------------------------------------------

function createSkillInfoTool(plugin: AgentSkillPlugin) {
  return tool(
    async () => {
      return JSON.stringify(
        {
          skillId: plugin.id,
          name: plugin.name,
          description: plugin.description,
          stages: plugin.stages,
          structureType: plugin.structureType,
          draftStageGuidance:
            plugin.markdownByStage.draft || '(no draft-stage guidance)',
        },
        null,
        2,
      );
    },
    {
      name: 'get_skill_parameter_info',
      description:
        'Query the parameter schema and extraction rules for the current structural type. ' +
        'Call once to understand what fields to extract.',
      schema: z.object({}),
    },
  );
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(
  locale: 'zh' | 'en',
  existingState: DraftState | undefined,
): string {
  const stateJson = JSON.stringify(existingState ?? {}, null, 2);

  if (locale === 'zh') {
    return [
      '你是结构工程参数提取专家。',
      '',
      '工作流程：',
      '1. 先调用 get_skill_parameter_info 了解该结构类型需要哪些参数',
      '2. 根据参数说明，从用户消息中提取工程参数',
      '3. 输出一个 JSON 对象，包含所有提取到的参数',
      '',
      '规则：',
      '- 参数字段名必须与 get_skill_parameter_info 返回的一致',
      '- 长度单位 m，力单位 kN，分布荷载 kN/m',
      '- 保留已有 draftState 中的所有参数值，补充新提取的值',
      '- 不确定时省略字段，不要猜测',
      '- 不输出元数据字段（updatedAt, skillId, structuralTypeKey, supportLevel, coordinateSemantics, supportNote）',
      '- 只输出纯 JSON 对象，不要 markdown 包装或解释',
      '',
      `已有 draftState:\n${stateJson}`,
    ].join('\n');
  }

  return [
    'You are a structural engineering parameter extraction specialist.',
    '',
    'Workflow:',
    '1. Call get_skill_parameter_info to understand what parameters the structural type needs',
    '2. Extract engineering parameters from the user message based on the guidance',
    '3. Output a JSON object with all extracted parameters',
    '',
    'Rules:',
    '- Parameter field names MUST match what get_skill_parameter_info returns',
    '- Length in meters, force in kN, distributed load in kN/m',
    '- Preserve ALL existing draftState parameter values, add newly extracted ones',
    '- Omit fields you are unsure about — do NOT guess',
    '- Do NOT output metadata fields (updatedAt, skillId, structuralTypeKey, supportLevel, coordinateSemantics, supportNote)',
    '- Output raw JSON only — no markdown fences, no explanations',
    '',
    `Existing draftState:\n${stateJson}`,
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

function parseDraftPatchFromMessages(
  messages: unknown[],
): Record<string, unknown> | null {
  // Walk messages in reverse to find the last AI message with JSON content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (
      msg != null &&
      typeof msg === 'object' &&
      typeof (msg as any)._getType === 'function' &&
      (msg as any)._getType() === 'ai'
    ) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
      const parsed = parseJsonObject(content);
      if (parsed) return parsed;
    }
  }
  return null;
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
  const skillInfoTool = createSkillInfoTool(input.plugin);
  const agent = createReactAgent({
    llm,
    tools: [skillInfoTool],
    prompt: buildPrompt(input.locale, input.existingState),
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(input.message)],
  });

  const patch = parseDraftPatchFromMessages(result.messages);
  log.debug({ pluginId, durationMs: Date.now() - start, hasDraftPatch: !!patch }, 'param extractor completed');
  return patch;
}
