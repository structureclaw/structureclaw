import { randomUUID } from 'crypto';
import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
import { prisma } from '../utils/database.js';
import type {
  AgentRunResult,
  AgentToolCall,
  AgentInteraction,
  ActiveToolSet,
  InteractionDefaultProposal,
} from './agent.js';

function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function hasActiveTool(activeToolIds: ActiveToolSet, toolId: string): boolean {
  return !activeToolIds || activeToolIds.has(toolId);
}

export function buildMetrics(toolCalls: AgentToolCall[]): NonNullable<AgentRunResult['metrics']> {
  const durations = toolCalls
    .map((call) => call.durationMs || 0)
    .filter((duration) => Number.isFinite(duration) && duration >= 0);
  const totalToolDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const maxToolDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
  const toolDurationMsByName: Record<string, number> = {};
  for (const call of toolCalls) {
    const duration = call.durationMs || 0;
    toolDurationMsByName[call.tool] = (toolDurationMsByName[call.tool] || 0) + duration;
  }

  return {
    toolCount: toolCalls.length,
    failedToolCount: toolCalls.filter((call) => call.status === 'error').length,
    totalToolDurationMs,
    averageToolDurationMs: durations.length > 0 ? totalToolDurationMs / durations.length : 0,
    maxToolDurationMs,
    toolDurationMsByName,
  };
}

export function buildInteractionQuestion(interaction: AgentInteraction, locale: AppLocale): string {
  const primaryQuestion = interaction.questions?.find(
    (item) => typeof item.question === 'string' && item.question.trim().length > 0,
  )?.question?.trim();
  if (primaryQuestion) {
    return primaryQuestion;
  }
  const questionSummary = interaction.questions?.map((item) => item.label).join(locale === 'zh' ? '、' : ', ')
    || localize(locale, '必要参数', 'required parameters');
  return localize(
    locale,
    `请确认：${questionSummary}。`,
    `Please confirm: ${questionSummary}.`,
  );
}

export function buildToolInteraction(state: import('./agent.js').AgentInteractionState, locale: AppLocale): AgentInteraction {
  const routeReason = state === 'completed'
    ? localize(locale, '工具调用已完成。', 'Tool invocation completed.')
    : state === 'blocked'
      ? localize(locale, '工具调用已触发，但被下游工具或校验失败阻断。', 'Tool invocation was attempted but blocked by downstream tool or validation failure.')
      : state === 'collecting'
        ? localize(locale, '等待用户补充信息。', 'Waiting for user input.')
        : state === 'confirming'
          ? localize(locale, '等待用户确认设计方案。', 'Waiting for user to confirm design proposal.')
          : localize(locale, '任务已排队执行。', 'Task queued for execution.');
  const nextActions: import('./agent.js').AgentUserDecision[] = state === 'completed' ? [] : ['revise'];
  return {
    state,
    stage: 'report',
    turnId: randomUUID(),
    routeHint: 'prefer_tool',
    routeReason,
    nextActions,
  };
}

export function buildRecommendedNextStep(
  assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
  interaction: AgentInteraction,
  locale: AppLocale,
  activeToolIds?: ActiveToolSet,
): string {
  if (assessment.criticalMissing.length > 0) {
    const nextLabel = interaction.questions?.[0]?.label || localize(locale, '关键参数', 'the key parameter');
    return localize(locale, `先补齐 ${nextLabel}。`, `Fill in ${nextLabel} first.`);
  }
  if (assessment.nonCriticalMissing.length > 0) {
    return localize(
      locale,
      '关键参数已基本齐备，继续确认 `run_analysis`、`run_code_check` 和 `generate_report` 的偏好。',
      'Primary geometry and loading are mostly ready; continue by confirming preferences for `run_analysis`, `run_code_check`, and `generate_report`.',
    );
  }
  if (!hasActiveTool(activeToolIds, 'run_analysis')) {
    return localize(
      locale,
      '当前能力集中未启用 `run_analysis`，可继续细化参数，或启用分析能力后再执行。',
      'The current capability set does not enable `run_analysis`. Keep refining the inputs, or enable analysis capability before execution.',
    );
  }
  return localize(
    locale,
    '当前参数已足够进入执行阶段，可以直接让我开始分析，或继续微调参数。',
    'The current parameters are sufficient to proceed. You can ask me to start the analysis now, or keep refining the inputs.',
  );
}

export function buildGenericModelingIntro(locale: AppLocale, noSkillMode: boolean): string {
  void noSkillMode;
  return localize(
    locale,
    '当前所选技能未命中更具体的结构技能。我会回退到通用建模能力。',
    'The selected skills did not match a more specific structural skill. I will fall back to generic modeling capability.',
  );
}

export function buildChatModeResponse(interaction: AgentInteraction, locale: AppLocale): string {
  const lines: string[] = [];
  if (interaction.interactionStageLabel) {
    lines.push(localize(locale, `当前阶段：${interaction.interactionStageLabel}`, `Current stage: ${interaction.interactionStageLabel}`));
  }
  if (interaction.fallbackSupportNote) {
    lines.push(interaction.fallbackSupportNote);
  }
  if (interaction.missingCritical?.length) {
    lines.push(localize(
      locale,
      `待补关键参数：${interaction.missingCritical.join('、')}`,
      `Critical parameters still needed: ${interaction.missingCritical.join(', ')}`,
    ));
  }
  if (interaction.missingOptional?.length) {
    lines.push(localize(
      locale,
      `后续建议确认：${interaction.missingOptional.join('、')}`,
      `Recommended to confirm next: ${interaction.missingOptional.join(', ')}`,
    ));
  }
  if (interaction.recommendedNextStep) {
    lines.push(localize(locale, `下一步：${interaction.recommendedNextStep}`, `Next step: ${interaction.recommendedNextStep}`));
  }
  if (interaction.questions?.length) {
    lines.push(localize(locale, `优先问题：${interaction.questions[0]?.question}`, `Priority question: ${interaction.questions[0]?.question}`));
  }
  return lines.join('\n');
}

export async function renderSummary(
  llm: ChatOpenAI | null,
  message: string,
  fallback: string,
  locale: AppLocale,
  analysisData?: unknown,
  conversationId?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!llm) {
    return fallback;
  }

  try {
    const hasData = analysisData && typeof analysisData === 'object';
    let conversationContext = '';
    if (conversationId) {
      try {
        const recentMessages = await prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { role: true, content: true },
        });
        if (recentMessages.length > 0) {
          conversationContext = recentMessages
            .reverse()
            .map((m: { role: string; content: string }) => `${m.role}: ${m.content.slice(0, 200)}`)
            .join('\n');
        }
      } catch {
        // Non-blocking: proceed without conversation context.
      }
    }
    const promptParts = [
      localize(locale, '你是结构工程 Agent 的结果解释器。', 'You explain results produced by the structural engineering agent.'),
      hasData
        ? localize(locale, '请用中文在 250 字以内，根据用户意图从分析数据中提取用户关心的结果并回答。只引用数据中存在的数值，不要杜撰。若用户询问的数据未在当前分析数据中提供，请明确说明，并引导用户查看结构化数据结果与可视化界面。', 'Respond in English within 250 words. Extract and present the results the user cares about from the analysis data. Only cite values present in the data; do not invent data. If the requested value is not available in the current analysis data, say so clearly and direct the user to the structured results and visualization view.')
        : localize(locale, '请用中文在 80 字以内给出结论，不要杜撰未出现的数据。', 'Respond in English within 80 words and do not invent data that was not provided.'),
    ];
    if (conversationContext) {
      promptParts.push(localize(locale, `对话上下文：\n${conversationContext}`, `Conversation context:\n${conversationContext}`));
    }
    promptParts.push(
      localize(locale, `用户意图：${message}`, `User intent: ${message}`),
      localize(locale, `系统结果：${fallback}`, `System result: ${fallback}`),
    );
    if (hasData) {
      const rawObj = analysisData as Record<string, unknown>;
      const dataObj = (rawObj.data && typeof rawObj.data === 'object' && !Array.isArray(rawObj.data) ? rawObj.data : rawObj) as Record<string, unknown>;
      const compact = JSON.stringify({
        analysisMode: dataObj['analysisMode'] ?? null,
        plane: dataObj['plane'] ?? null,
        summary: dataObj['summary'] ?? null,
        envelope: dataObj['envelope'] ?? null,
      });
      promptParts.push(localize(locale, `分析数据：${compact}`, `Analysis data: ${compact}`));
    }
    const prompt = promptParts.join('\n');
    const aiMessage = await llm.invoke(prompt, { signal });
    const content = typeof aiMessage.content === 'string'
      ? aiMessage.content
      : JSON.stringify(aiMessage.content);
    return content || fallback;
  } catch {
    return fallback;
  }
}
