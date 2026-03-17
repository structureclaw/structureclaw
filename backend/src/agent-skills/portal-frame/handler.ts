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

const ALLOWED_KEYS = ['spanLengthM', 'heightM', 'loadKN', 'loadType', 'loadPosition'] as const;

function toPortalFramePatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch({
    ...patch,
    spanLengthM: patch.spanLengthM ?? patch.lengthM,
  }, 'portal-frame', [...ALLOWED_KEYS]);
}

function buildPortalFrameDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'loadType':
      return locale === 'zh'
        ? '门式刚架首轮建议采用均布荷载，更接近常见屋面恒活载表达。'
        : 'For portal frames, start with distributed loading to better match common roof dead/live load representation.';
    case 'loadPosition':
      return locale === 'zh'
        ? '均布荷载默认按全跨施加，便于先得到整体受力水平。'
        : 'Apply distributed load over full span by default to quickly obtain global response trends.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildPortalFrameDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'portal-frame' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildPortalFrameDefaultReason(question.paramKey, locale),
    });
  }

  if (keys.includes('loadType')) {
    next.set('loadType', {
      paramKey: 'loadType',
      value: 'distributed',
      reason: buildPortalFrameDefaultReason('loadType', locale),
    });
  }
  if (keys.includes('loadPosition')) {
    next.set('loadPosition', {
      paramKey: 'loadPosition',
      value: 'full-span',
      reason: buildPortalFrameDefaultReason('loadPosition', locale),
    });
  }

  return Array.from(next.values());
}

function buildPortalFrameQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'portal-frame' }, locale).map((question) => {
    if (question.paramKey === 'heightM') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认门式刚架柱高（檐口高度）；若有屋脊变化请补充说明。'
          : 'Please confirm the portal-frame column/eave height; add notes if there is ridge-height variation.',
      };
    }
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认门式刚架荷载形式（point / distributed）。屋面恒载/活载通常可先按 distributed。'
          : 'Please confirm portal-frame load type (point / distributed). Roof dead/live loads are typically modeled as distributed first.',
        suggestedValue: 'distributed',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认荷载施加位置（midspan / end / full-span）。门架首轮建议先用 full-span。'
          : 'Please confirm load position (midspan / end / full-span). For portal-frame baseline checks, full-span is recommended first.',
        suggestedValue: 'full-span',
      };
    }
    return question;
  });
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('portal frame') || text.includes('门式刚架')) {
      return buildScenarioMatch('portal-frame', 'portal-frame', 'portal-frame', 'supported', locale);
    }
    if (text.includes('portal') || text.includes('门架') || text.includes('刚架')) {
      return buildScenarioMatch('portal', 'portal-frame', 'portal-frame', 'fallback', locale, {
        zh: '已将“门架/刚架”先收敛到门式刚架模板继续补参。',
        en: '“Portal structure” has been narrowed to the portal-frame template for continued guidance.',
      });
    }
    return null;
  },
  parseProvidedValues(values) {
    return toPortalFramePatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toPortalFramePatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toPortalFramePatch(patch), 'portal-frame', 'portal-frame');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'portal-frame' }, mode, ['spanLengthM', 'heightM', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildPortalFrameQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildPortalFrameDefaultProposals(keys, state, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'portal-frame' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
