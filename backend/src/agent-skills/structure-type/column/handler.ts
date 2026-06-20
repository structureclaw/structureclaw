import {
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyDraftPatchLlmFirst,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { buildInteractionQuestions } from '../../../agent-runtime/fallback.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
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

const ALLOWED_KEYS = ['heightM', 'lengthM', 'loadKN', 'loadType', 'loadPosition'];

function extractPositiveNumber(pattern: RegExp, message: string): number | undefined {
  const match = pattern.exec(message);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildNaturalColumnPatch(message: string): DraftExtraction {
  const text = message.toLowerCase();
  const patch: DraftExtraction = {};

  const height = extractPositiveNumber(/(?:高度|柱高|高)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/iu, message)
    ?? extractPositiveNumber(/\b(?:height|tall)\s*(?:of\s*)?([0-9]+(?:\.[0-9]+)?)\s*m\b/iu, text)
    ?? extractPositiveNumber(/\b([0-9]+(?:\.[0-9]+)?)\s*m\s*(?:high|tall|column height)\b/iu, text);
  if (height !== undefined) {
    patch.heightM = height;
    patch.lengthM = height;
  }

  const axialLoad = extractPositiveNumber(/(?:柱顶)?(?:轴向)?(?:荷载|轴力)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kN|kn|千牛)/iu, message)
    ?? extractPositiveNumber(/\b(?:axial\s*)?(?:load|force)\s*(?:of\s*)?([0-9]+(?:\.[0-9]+)?)\s*kN\b/iu, text)
    ?? extractPositiveNumber(/\b([0-9]+(?:\.[0-9]+)?)\s*kN\s*(?:axial\s*)?(?:load|force)\b/iu, text);
  if (axialLoad !== undefined) {
    patch.loadKN = axialLoad;
    patch.loadType = 'point';
    patch.loadPosition = 'top-nodes';
  }

  const section = message.match(/(?:截面|section)?\s*([0-9]+(?:\.[0-9]+)?)\s*[xX×*]\s*([0-9]+(?:\.[0-9]+)?)\s*mm/iu);
  const skillState: Record<string, unknown> = {};
  if (section?.[1] && section[2]) {
    skillState.sectionWidthM = Number(section[1]) / 1000;
    skillState.sectionDepthM = Number(section[2]) / 1000;
  }
  if (text.includes('concrete') || message.includes('混凝土') || message.includes('砼')) {
    skillState.materialFamily = 'concrete';
  } else if (text.includes('steel') || message.includes('钢')) {
    skillState.materialFamily = 'steel';
  }
  if (Object.keys(skillState).length > 0) {
    patch.skillState = skillState;
  }

  return patch;
}

function toColumnPatch(patch: DraftExtraction): DraftExtraction {
  const nextPatch: DraftExtraction = { inferredType: 'column' };
  nextPatch.heightM = patch.heightM;
  nextPatch.lengthM = patch.lengthM;
  nextPatch.loadKN = patch.loadKN;
  nextPatch.loadType = patch.loadType;
  nextPatch.loadPosition = patch.loadPosition;
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
  if (patch.skillState) {
    nextPatch.skillState = patch.skillState;
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
    const text = message.toLowerCase();
    if (text.includes('frame') || message.includes('框架')) {
      return null;
    }
    if (text.includes('column') || message.includes('柱')) {
      return buildStructuralTypeMatch('column', 'column', 'column', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toColumnPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toColumnPatch(
      mergeLegacyDraftPatchLlmFirst(
        normalizeLegacyDraftPatch(llmDraftPatch),
        buildNaturalColumnPatch(message),
      ),
    );
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
