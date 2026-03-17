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

const ALLOWED_KEYS = ['lengthM', 'loadKN', 'loadType', 'loadPosition'] as const;

function toTrussPatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch(patch, 'truss', [...ALLOWED_KEYS]);
}

function buildTrussDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'loadType':
      return locale === 'zh'
        ? '桁架默认采用节点集中力，符合杆系理想化输入方式。'
        : 'Default to nodal point load for truss systems, matching the idealized member-model input.';
    case 'loadPosition':
      return locale === 'zh'
        ? '默认作用在上弦节点，作为常见竖向工况的起步假定。'
        : 'Default to top-chord nodes as a common starting assumption for vertical loading cases.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildTrussDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'truss' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildTrussDefaultReason(question.paramKey, locale),
    });
  }

  if (keys.includes('loadType')) {
    next.set('loadType', {
      paramKey: 'loadType',
      value: 'point',
      reason: buildTrussDefaultReason('loadType', locale),
    });
  }
  if (keys.includes('loadPosition')) {
    next.set('loadPosition', {
      paramKey: 'loadPosition',
      value: 'top-nodes',
      reason: buildTrussDefaultReason('loadPosition', locale),
    });
  }

  return Array.from(next.values());
}

function buildTrussQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'truss' }, locale).map((question) => {
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认桁架荷载形式（point / distributed）。桁架通常优先按节点集中力 point 输入。'
          : 'Please confirm truss load type (point / distributed). Trusses are typically input as nodal point loads first.',
        suggestedValue: 'point',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认荷载位置（top-nodes / middle-joint / free-joint）。常规竖向工况建议先用 top-nodes。'
          : 'Please confirm load position (top-nodes / middle-joint / free-joint). For common vertical cases, start with top-nodes.',
        suggestedValue: 'top-nodes',
      };
    }
    return question;
  });
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('truss') || text.includes('桁架')) {
      return buildScenarioMatch('truss', 'truss', 'truss', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toTrussPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toTrussPatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toTrussPatch(patch), 'truss', 'truss');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'truss' }, mode, ['lengthM', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildTrussQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildTrussDefaultProposals(keys, state, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'truss' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
