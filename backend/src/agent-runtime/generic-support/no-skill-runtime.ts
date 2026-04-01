import type { AppLocale } from '../../services/locale.js';
import type { DraftState } from '../index.js';

export function normalizeNoSkillDraftState(_state: DraftState): DraftState {
  return {
    inferredType: 'unknown',
    skillId: undefined,
    structuralTypeKey: undefined,
    supportLevel: undefined,
    supportNote: undefined,
    skillState: undefined,
    updatedAt: Date.now(),
  };
}

export function computeNoSkillMissingFields(locale: AppLocale): string[] {
  if (locale === 'zh') {
    return ['当前未启用结构技能。请继续以自然语言描述需求，或启用相关技能后再生成可计算结构模型。'];
  }
  return ['No structure skills are enabled. Continue with natural-language discussion, or enable relevant skills before generating a computable structural model.'];
}
