import type { ToolManifest } from '../../agent-runtime/types.js';
import type { DraftResult, DraftState, StructuralTypeMatch } from '../../agent-runtime/index.js';
import type { AppLocale } from '../../services/locale.js';
import { localize } from './shared.js';

function localeText(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

interface UpdateToolSession {
  draft?: DraftState;
  structuralTypeMatch?: StructuralTypeMatch;
  latestModel?: Record<string, unknown>;
  updatedAt: number;
}

export async function executeUpdateModel(args: {
  message: string;
  locale: AppLocale;
  skillIds?: string[];
  workingSession: UpdateToolSession;
  textToModelDraft: (message: string, existingState: DraftState | undefined, locale: AppLocale, skillIds?: string[]) => Promise<DraftResult>;
  isGenericFallbackDraft: (draft: DraftResult) => boolean;
  applyInferredNonCriticalFromMessage: (workingSession: UpdateToolSession, message: string) => void;
}): Promise<{ draft: DraftResult; genericFallbackDraft: boolean }> {
  const draft = await args.textToModelDraft(args.message, args.workingSession.draft, args.locale, args.skillIds);
  const genericFallbackDraft = args.isGenericFallbackDraft(draft);

  if (draft.stateToPersist) {
    args.workingSession.draft = draft.stateToPersist;
  }
  if (draft.model) {
    args.workingSession.latestModel = draft.model;
  }
  if (draft.structuralTypeMatch) {
    args.workingSession.structuralTypeMatch = draft.structuralTypeMatch;
  } else if (genericFallbackDraft) {
    args.workingSession.structuralTypeMatch = undefined;
  }
  args.workingSession.updatedAt = Date.now();
  args.applyInferredNonCriticalFromMessage(args.workingSession, args.message);

  return {
    draft,
    genericFallbackDraft,
  };
}

export async function executeUpdateModelExecutionStep(args: {
  message: string;
  locale: AppLocale;
  skillIds?: string[];
  sessionKey?: string;
  plan: string[];
  toolCalls: any[];
  workingSession: UpdateToolSession;
  startToolCall: (tool: 'update_model', input: Record<string, unknown>) => any;
  completeToolCallSuccess: (call: any, output: Record<string, unknown>) => void;
  textToModelDraft: (message: string, existingState: DraftState | undefined, locale: AppLocale, skillIds?: string[]) => Promise<DraftResult>;
  isGenericFallbackDraft: (draft: DraftResult) => boolean;
  applyInferredNonCriticalFromMessage: (workingSession: UpdateToolSession, message: string) => void;
}): Promise<{ draft: DraftResult; genericFallbackDraft: boolean }> {
  args.plan.push(localeText(args.locale, '根据当前会话上下文增量更新结构模型', 'Update the structural model incrementally using the current session context'));

  const updateCall = args.startToolCall('update_model', { message: args.message, conversationId: args.sessionKey, phase: 'execution' });
  args.toolCalls.push(updateCall);

  const execution = await executeUpdateModel({
    message: args.message,
    locale: args.locale,
    skillIds: args.skillIds,
    workingSession: args.workingSession,
    textToModelDraft: args.textToModelDraft,
    isGenericFallbackDraft: args.isGenericFallbackDraft,
    applyInferredNonCriticalFromMessage: args.applyInferredNonCriticalFromMessage,
  });

  args.completeToolCallSuccess(updateCall, {
    inferredType: execution.draft.inferredType,
    missingFields: execution.draft.missingFields,
    extractionMode: execution.draft.extractionMode,
    modelUpdated: Boolean(execution.draft.model),
  });

  return execution;
}

export const UPDATE_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'update_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('更新结构模型', 'Update Structural Model'),
  description: localize('基于现有会话中的结构模型与参数，对几何、荷载、材料、截面和边界条件进行增量更新。', 'Apply incremental updates to geometry, loads, materials, sections, and boundary conditions based on the existing structural model context.'),
  tags: ['update', 'model', 'structure-type'],
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
