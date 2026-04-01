import type { ToolManifest } from '../../agent-runtime/types.js';
import type { DraftResult, DraftState, StructuralTypeMatch } from '../../agent-runtime/index.js';
import type { AppLocale } from '../../services/locale.js';
import { localize } from './shared.js';

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
  isNoSkillEquivalentDraft: (skillIds: string[] | undefined, draft: DraftResult) => boolean;
  applyInferredNonCriticalFromMessage: (workingSession: UpdateToolSession, message: string) => void;
}): Promise<{ draft: DraftResult; noSkillEquivalentDraft: boolean }> {
  const draft = await args.textToModelDraft(args.message, args.workingSession.draft, args.locale, args.skillIds);
  const noSkillEquivalentDraft = args.isNoSkillEquivalentDraft(args.skillIds, draft);

  if (draft.stateToPersist) {
    args.workingSession.draft = draft.stateToPersist;
  }
  if (draft.model) {
    args.workingSession.latestModel = draft.model;
  }
  if (draft.structuralTypeMatch) {
    args.workingSession.structuralTypeMatch = draft.structuralTypeMatch;
  } else if (noSkillEquivalentDraft) {
    args.workingSession.structuralTypeMatch = undefined;
  }
  args.workingSession.updatedAt = Date.now();
  args.applyInferredNonCriticalFromMessage(args.workingSession, args.message);

  return {
    draft,
    noSkillEquivalentDraft,
  };
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
