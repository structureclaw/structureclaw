import {
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { projectEngineeringDraftToLegacyPatch } from '../../../agent-runtime/engineering-draft.js';
import { buildInteractionQuestions } from '../../../agent-runtime/fallback.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
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

const ALLOWED_KEYS = ['heightM', 'lengthM', 'loadKN', 'loadType', 'loadPosition'];

function toColumnPatch(patch: DraftExtraction): DraftExtraction {
  const semanticPatch = projectEngineeringDraftToLegacyPatch(patch, 'column');
  const nextPatch: DraftExtraction = { inferredType: 'column' };
  nextPatch.engineeringDraft = semanticPatch.engineeringDraft;
  nextPatch.draftIssues = semanticPatch.draftIssues;
  nextPatch.heightM = semanticPatch.heightM;
  nextPatch.lengthM = semanticPatch.lengthM;
  nextPatch.loadKN = semanticPatch.loadKN;
  nextPatch.loadType = semanticPatch.loadType;
  nextPatch.loadPosition = semanticPatch.loadPosition;
  if (nextPatch.heightM === undefined && nextPatch.lengthM !== undefined) {
    nextPatch.heightM = nextPatch.lengthM;
  }
  if (nextPatch.lengthM === undefined && nextPatch.heightM !== undefined) {
    nextPatch.lengthM = nextPatch.heightM;
  }
  if (nextPatch.loadKN !== undefined) {
    nextPatch.loadType = nextPatch.loadType ?? 'point';
    nextPatch.loadPosition = nextPatch.loadPosition ?? 'top-nodes';
  }
  if (semanticPatch.skillState) {
    nextPatch.skillState = semanticPatch.skillState;
  }
  return nextPatch;
}

function buildColumnQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'column' }, locale).map((question) => {
    if (question.paramKey === 'heightM' || question.paramKey === 'lengthM') {
      return {
        ...question,
        label: locale === 'zh' ? '柱高' : 'Column height',
        question: locale === 'zh' ? '请确认柱高。' : 'Please confirm the column height.',
      };
    }
    if (question.paramKey === 'loadKN') {
      return {
        ...question,
        question: locale === 'zh' ? '请确认柱顶轴向荷载大小。' : 'Please confirm the top axial load.',
      };
    }
    return question;
  });
}

function buildColumnDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  return buildInteractionQuestions(keys, [], { ...state, inferredType: 'column' }, locale)
    .filter((question) => question.suggestedValue !== undefined)
    .map((question) => ({
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: locale === 'zh'
        ? `根据 ${question.paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${question.paramKey}.`,
    }));
}

function buildColumnReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const notes = [
    '',
    input.locale === 'zh' ? '## 柱专项说明' : '## Column Notes',
    input.locale === 'zh'
      ? '- 当前模型按单根竖向柱和柱顶轴向荷载处理，适合首轮构件级静力分析。'
      : '- This model treats the member as a standalone vertical column with a top axial load for first-pass member analysis.',
  ];
  return [base, ...notes].join('\n');
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale }) {
    const route = matchConservativeStructuralRoute(message);
    if (route?.skillId === 'column') {
      return buildStructuralTypeMatch('column', 'column', 'column', route.supportLevel, locale, undefined, route.routingSource);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toColumnPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ llmDraftPatch }) {
    return toColumnPatch(normalizeLegacyDraftPatch(llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toColumnPatch(patch), 'column', 'column');
  },
  computeMissing(state, phase) {
    return computeLegacyMissing({ ...state, inferredType: 'column' }, phase, [...ALLOWED_KEYS]);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildColumnQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildColumnDefaultProposals(keys, state, locale);
  },
  buildReportNarrative(input) {
    return buildColumnReportNarrative(input);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'column' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
