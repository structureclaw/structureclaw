import type { ToolManifest } from '../../agent-runtime/types.js';
import type { DraftResult, DraftState } from '../../agent-runtime/index.js';
import type { AppLocale } from '../../services/locale.js';
import { localize } from './shared.js';

function localeText(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

export async function executeDraftModel(args: {
  message: string;
  locale: AppLocale;
  skillIds?: string[];
  workingSession: { draft?: DraftState; updatedAt: number };
  textToModelDraft: (message: string, existingState: DraftState | undefined, locale: AppLocale, skillIds?: string[]) => Promise<DraftResult>;
  isGenericFallbackDraft: (draft: DraftResult) => boolean;
  applyDraftToSession: (workingSession: any, draft: DraftResult, genericFallbackDraft: boolean, message: string) => void;
}): Promise<{ draft: DraftResult; genericFallbackDraft: boolean }> {
  const draft = await args.textToModelDraft(args.message, args.workingSession.draft, args.locale, args.skillIds);
  const genericFallbackDraft = args.isGenericFallbackDraft(draft);
  args.applyDraftToSession(args.workingSession, draft, genericFallbackDraft, args.message);
  return {
    draft,
    genericFallbackDraft,
  };
}

export async function executeDraftModelInteractiveStep(args: {
  message: string;
  locale: AppLocale;
  skillIds?: string[];
  sessionKey?: string;
  plan: string[];
  toolCalls: any[];
  workingSession: { draft?: DraftState; updatedAt: number };
  startToolCall: (tool: 'draft_model', input: Record<string, unknown>) => any;
  completeToolCallSuccess: (call: any, output: Record<string, unknown>) => void;
  textToModelDraft: (message: string, existingState: DraftState | undefined, locale: AppLocale, skillIds?: string[]) => Promise<DraftResult>;
  isGenericFallbackDraft: (draft: DraftResult) => boolean;
  applyDraftToSession: (workingSession: any, draft: DraftResult, genericFallbackDraft: boolean, message: string) => void;
}): Promise<{ draft: DraftResult; genericFallbackDraft: boolean }> {
  args.plan.push(localeText(args.locale, '由当前可用 skill 理解请求并细化结构草稿', 'Use the current available skills to understand the request and refine the structural draft'));
  args.plan.push(localeText(args.locale, '按当前阶段补齐关键工程参数', 'Collect the key engineering parameters for the current stage'));

  const draftCall = args.startToolCall('draft_model', { message: args.message, conversationId: args.sessionKey, phase: 'interactive' });
  args.toolCalls.push(draftCall);

  const execution = await executeDraftModel({
    message: args.message,
    locale: args.locale,
    skillIds: args.skillIds,
    workingSession: args.workingSession,
    textToModelDraft: args.textToModelDraft,
    isGenericFallbackDraft: args.isGenericFallbackDraft,
    applyDraftToSession: args.applyDraftToSession,
  });

  args.completeToolCallSuccess(draftCall, {
    inferredType: execution.draft.inferredType,
    missingFields: execution.draft.missingFields,
    extractionMode: execution.draft.extractionMode,
    modelGenerated: Boolean(execution.draft.model),
  });

  return execution;
}

export async function executeDraftModelExecutionStep(args: {
  message: string;
  locale: AppLocale;
  skillIds?: string[];
  sessionKey?: string;
  plan: string[];
  toolCalls: any[];
  workingSession: { draft?: DraftState; updatedAt: number };
  startToolCall: (tool: 'draft_model', input: Record<string, unknown>) => any;
  completeToolCallSuccess: (call: any, output: Record<string, unknown>) => void;
  textToModelDraft: (message: string, existingState: DraftState | undefined, locale: AppLocale, skillIds?: string[]) => Promise<DraftResult>;
  isGenericFallbackDraft: (draft: DraftResult) => boolean;
  applyDraftToSession: (workingSession: any, draft: DraftResult, genericFallbackDraft: boolean, message: string) => void;
}): Promise<{ draft: DraftResult; genericFallbackDraft: boolean }> {
  args.plan.push(localeText(args.locale, '从自然语言生成结构模型草案（支持会话级补数）', 'Generate a structural model draft from natural language with session carry-over'));

  const draftCall = args.startToolCall('draft_model', { message: args.message, conversationId: args.sessionKey, phase: 'execution' });
  args.toolCalls.push(draftCall);

  const execution = await executeDraftModel({
    message: args.message,
    locale: args.locale,
    skillIds: args.skillIds,
    workingSession: args.workingSession,
    textToModelDraft: args.textToModelDraft,
    isGenericFallbackDraft: args.isGenericFallbackDraft,
    applyDraftToSession: args.applyDraftToSession,
  });

  args.completeToolCallSuccess(draftCall, {
    inferredType: execution.draft.inferredType,
    missingFields: execution.draft.missingFields,
    extractionMode: execution.draft.extractionMode,
    modelGenerated: Boolean(execution.draft.model),
  });

  return execution;
}

export const DRAFT_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'draft_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('草拟结构模型', 'Draft Structural Model'),
  description: localize('从文本和补充参数生成或更新可计算结构模型草稿。', 'Generate or update a computable structural model draft from text and provided parameters.'),
  tags: ['draft', 'model', 'structure-type'],
  inputSchema: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string' },
      conversationId: { type: 'string' },
      phase: { enum: ['interactive', 'execution'] },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      inferredType: { type: 'string' },
      missingFields: { type: 'array', items: { type: 'string' } },
      extractionMode: { enum: ['llm', 'deterministic'] },
      model: { type: 'object' },
    },
  },
  errorCodes: ['AGENT_MISSING_MODEL_INPUT'],
};
