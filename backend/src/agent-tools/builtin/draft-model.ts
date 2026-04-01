import type { ToolManifest } from '../../agent-runtime/types.js';
import type { DraftResult, DraftState } from '../../agent-runtime/index.js';
import type { AppLocale } from '../../services/locale.js';
import { localize } from './shared.js';

export async function executeDraftModel(args: {
  message: string;
  locale: AppLocale;
  skillIds?: string[];
  prefetchedDraft?: DraftResult;
  workingSession: { draft?: DraftState; updatedAt: number };
  textToModelDraft: (message: string, existingState: DraftState | undefined, locale: AppLocale, skillIds?: string[]) => Promise<DraftResult>;
  isNoSkillEquivalentDraft: (skillIds: string[] | undefined, draft: DraftResult) => boolean;
  applyDraftToSession: (workingSession: any, draft: DraftResult, noSkillEquivalentDraft: boolean, message: string) => void;
}): Promise<{ draft: DraftResult; noSkillEquivalentDraft: boolean }> {
  const draft = args.prefetchedDraft ?? await args.textToModelDraft(args.message, args.workingSession.draft, args.locale, args.skillIds);
  const noSkillEquivalentDraft = args.isNoSkillEquivalentDraft(args.skillIds, draft);
  args.applyDraftToSession(args.workingSession, draft, noSkillEquivalentDraft, args.message);
  return {
    draft,
    noSkillEquivalentDraft,
  };
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
