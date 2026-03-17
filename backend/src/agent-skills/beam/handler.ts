import {
  buildLegacyDraftPatchLlmFirst,
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../services/agent-skills/legacy.js';
import { buildScenarioMatch, resolveLegacyStructuralStage } from '../../services/agent-skills/plugin-helpers.js';
import { buildInteractionQuestions } from '../../services/agent-skills/fallback.js';
import type { AppLocale } from '../../services/locale.js';
import type { DraftExtraction, DraftState, InteractionQuestion, SkillDefaultProposal, SkillHandler } from '../../services/agent-skills/types.js';

const ALLOWED_KEYS = ['lengthM', 'supportType', 'loadKN', 'loadType', 'loadPosition'] as const;

function toBeamPatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch(patch, 'beam', [...ALLOWED_KEYS]);
}

function buildBeamDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'supportType':
      return locale === 'zh'
        ? '默认按简支梁起步，便于先快速完成内力与变形首轮校核。'
        : 'Default to a simply-supported beam so the first-force and deflection check can run quickly.';
    case 'loadType':
      return locale === 'zh'
        ? '默认按均布荷载建模，更贴近梁构件常见受力工况。'
        : 'Default to a distributed load, which better matches common beam loading scenarios.';
    case 'loadPosition':
      return locale === 'zh'
        ? '均布荷载默认作用于全跨，便于获得连续响应包络。'
        : 'For distributed loading, default to full-span action to obtain continuous response envelopes.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildBeamDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'beam' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildBeamDefaultReason(question.paramKey, locale),
    });
  }

  if (keys.includes('loadType')) {
    next.set('loadType', {
      paramKey: 'loadType',
      value: 'distributed',
      reason: buildBeamDefaultReason('loadType', locale),
    });
  }
  if (keys.includes('loadPosition')) {
    next.set('loadPosition', {
      paramKey: 'loadPosition',
      value: 'full-span',
      reason: buildBeamDefaultReason('loadPosition', locale),
    });
  }

  return Array.from(next.values());
}

function buildBeamQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'beam' }, locale).map((question) => {
    if (question.paramKey === 'supportType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '梁边界条件默认可按简支开始；若是悬臂或固接，请明确说明支座形式。'
          : 'You can start with simply-supported beam boundaries by default; specify if the beam is cantilever or fixed-ended.',
        suggestedValue: 'simply-supported',
      };
    }
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认梁荷载形式（集中力 point / 均布荷载 distributed）。常规工况建议先用均布荷载。'
          : 'Please confirm beam load type (point / distributed). For typical cases, distributed load is recommended as the starting point.',
        suggestedValue: 'distributed',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认梁荷载作用位置（跨中 midspan / 端部 end / 全跨 full-span）；均布荷载通常取全跨。'
          : 'Please confirm beam load position (midspan / end / full-span); for distributed load, full-span is usually preferred.',
        suggestedValue: 'full-span',
      };
    }
    return question;
  });
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('portal frame') || text.includes('门式刚架') || text.includes('桁架') || text.includes('truss') || text.includes('双跨梁') || text.includes('double-span')) {
      return null;
    }
    if (text.includes('girder') || text.includes('主梁') || text.includes('大梁')) {
      return buildScenarioMatch('girder', 'beam', 'beam', 'fallback', locale, {
        zh: '已将“主梁/大梁”先按梁模板处理；若实际是连续梁或更复杂体系，请继续说明。',
        en: '“Girder” has been normalized to the beam template for now. If the actual system is continuous or more complex, please clarify further.',
      });
    }
    if (text.includes('beam') || text.includes('梁') || text.includes('悬臂')) {
      return buildScenarioMatch('beam', 'beam', 'beam', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toBeamPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toBeamPatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toBeamPatch(patch), 'beam', 'beam');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'beam' }, mode, ['lengthM', 'supportType', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildBeamQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildBeamDefaultProposals(keys, state, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'beam' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
