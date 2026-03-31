import {
  buildLegacyDraftPatchLlmFirst,
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { combineDomainKeys, composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildInteractionQuestions } from '../../../agent-runtime/fallback.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
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
  const domainPatch = composeStructuralDomainPatch({
    patch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
    spanLengthAliasFromLength: true,
  });
  return restrictLegacyDraftPatch(domainPatch, 'double-span-beam', [...ALLOWED_KEYS]);
}

function buildDoubleSpanDefaultReason(paramKey: string, locale: AppLocale): string {
  switch (paramKey) {
    case 'loadType':
      return locale === 'zh'
        ? '双跨连续梁默认按均布荷载起步，便于快速识别跨中与中支座内力分配。'
        : 'For a double-span continuous beam, start with distributed loading to quickly capture span and interior-support force sharing.';
    case 'loadPosition':
      return locale === 'zh'
        ? '默认全跨加载以覆盖两跨共同工作特征。'
        : 'Default to full-span loading to represent coupled action across both spans.';
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
          ? '请确认双跨梁每跨跨度（默认两跨等跨；若不等跨请分别说明）。'
          : 'Please confirm the span length per bay for the double-span beam (equal spans by default; specify otherwise if unequal).',
      };
    }
    if (question.paramKey === 'loadType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认双跨梁荷载形式（point / distributed）。连续梁首轮建议用 distributed。'
          : 'Please confirm double-span load type (point / distributed). For first-pass continuous-beam checks, distributed is recommended.',
        suggestedValue: 'distributed',
      };
    }
    if (question.paramKey === 'loadPosition') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认荷载位置（midspan / end / full-span）。双跨连续作用通常先按 full-span。'
          : 'Please confirm load position (midspan / end / full-span). For coupled two-span behavior, start with full-span in most cases.',
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
    input.locale === 'zh' ? '## 双跨连续梁专项说明' : '## Double-Span Continuous Beam Notes',
    input.locale === 'zh'
      ? '- 双跨连续梁建议重点关注中间支座负弯矩与跨中正弯矩的组合控制关系。'
      : '- For double-span continuous beams, focus on the combined control of negative moment at the interior support and positive moment at span centers.',
    input.locale === 'zh'
      ? '- 若两跨不等跨或荷载不对称，建议分别定义分跨荷载与工况组合后再进行校核对比。'
      : '- If spans are unequal or loading is asymmetric, define per-span loads and load combinations explicitly before check comparisons.',
  ];
  return [base, ...continuousBeamNotes].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('double-span') || text.includes('双跨梁')) {
      return buildStructuralTypeMatch('double-span-beam', 'double-span-beam', 'double-span-beam', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toDoubleSpanPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toDoubleSpanPatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
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
    return buildLegacyModel({ ...state, inferredType: 'double-span-beam' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
