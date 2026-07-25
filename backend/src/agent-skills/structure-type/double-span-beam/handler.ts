import {
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLlmDraftPatch,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { projectEngineeringDraftToLegacyPatch } from '../../../agent-runtime/engineering-draft.js';
import { combineDomainKeys, composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildInteractionQuestions } from '../../../agent-runtime/fallback.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
import { matchConservativeStructuralRoute } from '../../../agent-runtime/structural-routing.js';
import type { AppLocale } from '../../../services/locale.js';
import type {
  DraftExtraction,
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

const GEOMETRY_KEYS = ['spanLengthM'] as const;
const LOAD_BOUNDARY_KEYS = ['loadKN', 'loadType', 'loadPosition'] as const;
const ALLOWED_KEYS = combineDomainKeys(GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS);

function toDoubleSpanPatch(patch: DraftExtraction): DraftExtraction {
  const semanticPatch = projectEngineeringDraftToLegacyPatch(patch, 'double-span-beam');
  const domainPatch = composeStructuralDomainPatch({
    patch: semanticPatch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
    spanLengthAliasFromLength: true,
  });
  const nextPatch = restrictLegacyDraftPatch(domainPatch, 'double-span-beam', [...ALLOWED_KEYS]);
  if (semanticPatch.engineeringDraft) {
    nextPatch.engineeringDraft = semanticPatch.engineeringDraft;
  }
  if (semanticPatch.skillState) {
    nextPatch.skillState = semanticPatch.skillState;
  }
  return nextPatch;
}

function buildDoubleSpanDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'loadType':
      return locale === 'zh'
        ? '连续梁默认按均布荷载起步，便于快速识别跨中与中间支座的内力分配。'
        : 'For a continuous beam, start with distributed loading to quickly capture span and interior-support force sharing.';
    case 'loadPosition':
      return locale === 'zh'
        ? '默认全跨加载以覆盖各跨共同工作特征。'
        : 'Default to full-span loading to represent coupled action across all spans.';
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildDoubleSpanDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'double-span-beam' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildDoubleSpanDefaultReason(question.paramKey, locale),
    });
  }

  if (keys.includes('loadType')) {
    next.set('loadType', {
      paramKey: 'loadType',
      value: 'distributed',
      reason: buildDoubleSpanDefaultReason('loadType', locale),
    });
  }
  if (keys.includes('loadPosition')) {
    next.set('loadPosition', {
      paramKey: 'loadPosition',
      value: 'full-span',
      reason: buildDoubleSpanDefaultReason('loadPosition', locale),
    });
  }

  return Array.from(next.values());
}

function buildDoubleSpanQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'double-span-beam' }, locale).map((question) => {
    if (question.paramKey === 'spanLengthM') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认连续梁的跨数及各跨跨度；若为等跨，也可直接给出统一跨度。'
          : 'Please confirm the number of spans and each span length; for equal spans, one common span length is sufficient.',
      };
    }
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认连续梁荷载形式（point / distributed）。首轮分析建议用 distributed。'
          : 'Please confirm the continuous-beam load type (point / distributed). Distributed loading is recommended for a first-pass analysis.',
        suggestedValue: 'distributed',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认荷载位置或作用跨（midspan / end / full-span）。各跨共同作用时通常先按 full-span。'
          : 'Please confirm the load position or loaded spans (midspan / end / full-span). For coupled multi-span behavior, start with full-span in most cases.',
        suggestedValue: 'full-span',
      };
    }
    return question;
  });
}

function buildDoubleSpanReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const continuousBeamNotes = [
    '',
    input.locale === 'zh' ? '## 连续梁专项说明' : '## Continuous Beam Notes',
    input.locale === 'zh'
      ? '- 连续梁建议重点关注各中间支座负弯矩与各跨跨中正弯矩的组合控制关系。'
      : '- For continuous beams, focus on the combined control of negative moments at interior supports and positive moments at span centers.',
    input.locale === 'zh'
      ? '- 若各跨不等跨或荷载不对称，建议分别定义分跨荷载与工况组合后再进行校核对比。'
      : '- If spans are unequal or loading is asymmetric, define per-span loads and load combinations explicitly before check comparisons.',
  ];
  return [base, ...continuousBeamNotes].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale }) {
    const route = matchConservativeStructuralRoute(message);
    if (route?.skillId === 'double-span-beam') {
      return buildStructuralTypeMatch(
        'double-span-beam',
        'double-span-beam',
        'double-span-beam',
        route.supportLevel,
        locale,
        undefined,
        route.routingSource,
      );
    }
    return null;
  },
  parseProvidedValues(values) {
    return toDoubleSpanPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ llmDraftPatch }) {
    return toDoubleSpanPatch(normalizeLlmDraftPatch(llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toDoubleSpanPatch(patch), 'double-span-beam', 'double-span-beam');
  },
  computeMissing(state, phase) {
    return computeLegacyMissing({ ...state, inferredType: 'double-span-beam' }, phase, [...ALLOWED_KEYS]);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildDoubleSpanQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildDoubleSpanDefaultProposals(keys, state, locale);
  },
  buildReportNarrative(input) {
    return buildDoubleSpanReportNarrative(input);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'double-span-beam' }, [...ALLOWED_KEYS]);
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
