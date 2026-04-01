import {
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  normalizeLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import {
  buildModel as buildFallbackModel,
  computeMissingCriticalKeys,
  mergeDraftState,
} from '../../../agent-runtime/fallback.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
import type {
  DraftExtraction,
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

const GENERIC_ALLOWED_KEYS = [
  'lengthM',
  'spanLengthM',
  'heightM',
  'supportType',
  'frameDimension',
  'storyCount',
  'bayCount',
  'bayCountX',
  'bayCountY',
  'storyHeightsM',
  'bayWidthsM',
  'bayWidthsXM',
  'bayWidthsYM',
  'floorLoads',
  'frameBaseSupportType',
  'loadKN',
  'loadType',
  'loadPosition',
  'loadPositionM',
] as const;

function hasStructuralIntent(text: string): boolean {
  if (/(beam|truss|frame|portal|girder|cantilever|support|span|bay|story|load|model|analysis|design|member|node|element|structure)/i.test(text)) {
    return true;
  }
  if (/(梁|桁架|框架|刚架|门架|跨度|跨|层|荷载|支座|结构|模型|分析|设计|构件|节点)/.test(text)) {
    return true;
  }
  return /(\d+(?:\.\d+)?)\s*(m|米|kn|kN|千牛)/.test(text);
}

function buildGenericPatch(
  message: string,
  llmDraftPatch?: Record<string, unknown> | null,
  currentState?: DraftState,
): DraftExtraction {
  const merged = normalizeLegacyDraftPatch(llmDraftPatch) || {};
  const normalizedMessage = message.toLowerCase();
  const isReplacementUpdate = /改成|改为|调整为|更新为|改到|change to|update/i.test(message);
  const mentionsXDirection = /x方向|x向/i.test(normalizedMessage);
  const mentionsYDirection = /y方向|y向/i.test(normalizedMessage);

  const normalizedFloorLoads = Array.isArray(merged.floorLoads)
    ? merged.floorLoads.map((load) => ({ ...load }))
    : undefined;

  if (currentState?.inferredType === 'frame') {
    const floorLoads = normalizedFloorLoads
      ? normalizedFloorLoads.map((load) => ({
          ...load,
          lateralYKN: currentState.frameDimension === '3d' && isReplacementUpdate && mentionsXDirection && !mentionsYDirection
            ? (load.lateralYKN ?? 0)
            : load.lateralYKN,
          lateralXKN: isReplacementUpdate && mentionsYDirection && !mentionsXDirection
            ? (load.lateralXKN ?? 0)
            : load.lateralXKN,
        }))
      : undefined;
    return {
      ...merged,
      floorLoads,
    };
  }

  return {
    ...merged,
    floorLoads: normalizedFloorLoads,
  };
}

function buildGenericDefaultProposals(
  keys: string[],
  state: DraftState,
  locale: 'zh' | 'en',
): SkillDefaultProposal[] {
  const questions = buildGenericQuestions(keys, [], state, locale);
  return questions
    .filter((question) => question.suggestedValue !== undefined)
    .map((question) => ({
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: locale === 'zh'
        ? `根据 ${question.label} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${question.label}.`,
    }));
}

function buildGenericQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: 'zh' | 'en',
): InteractionQuestion[] {
  if (state.inferredType === 'unknown') {
    return keys.map((paramKey) => ({
      paramKey,
      label: locale === 'zh' ? '结构体系' : 'Structural system',
      question: locale === 'zh'
        ? '请先描述结构体系、构件连接关系和主要荷载；如果你已经有可计算结构模型，也可以直接贴 JSON。'
        : 'Please first describe the structural system, member connectivity, and main loads. If you already have a computable structural model, you can paste the JSON directly.',
      required: true,
      critical: criticalMissing.includes(paramKey),
    }));
  }

  const labels = buildLegacyLabels(keys, locale);
  return keys.map((paramKey, index) => {
    const label = labels[index] || paramKey;
    return {
      paramKey,
      label,
      question: locale === 'zh'
        ? `请补充${label}。`
        : `Please provide ${label}.`,
      required: true,
      critical: criticalMissing.includes(paramKey),
    };
  });
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale, currentState }) {
    if (currentState?.skillId === 'generic') {
      return buildStructuralTypeMatch(
        currentState.structuralTypeKey ?? 'unknown',
        currentState.inferredType,
        'generic',
        currentState.supportLevel ?? 'fallback',
        locale,
        {
          zh: '继续使用通用结构类型 skill 处理当前对话。',
          en: 'Continue using the generic structure-type skill for the current conversation.',
        },
      );
    }

    if (!hasStructuralIntent(message)) {
      return null;
    }

    return buildStructuralTypeMatch('unknown', 'unknown', 'generic', 'fallback', locale, {
      zh: '已切换到通用结构类型 skill，先接住当前问题并继续补参。',
      en: 'Switched to the generic structure-type skill to catch the request and continue clarification.',
    });
  },
  parseProvidedValues(values) {
    return normalizeLegacyDraftPatch(values);
  },
  extractDraft({ message, llmDraftPatch, currentState }) {
    return buildGenericPatch(message, llmDraftPatch, currentState);
  },
  mergeState(existing, patch) {
    const merged = mergeDraftState(existing, patch);
    const inferredType = patch.inferredType ?? existing?.inferredType ?? 'unknown';
    return {
      ...merged,
      inferredType,
      skillId: 'generic',
      structuralTypeKey: (patch.structuralTypeKey ?? existing?.structuralTypeKey ?? (inferredType === 'unknown' ? 'unknown' : inferredType)) as DraftState['structuralTypeKey'],
      supportLevel: patch.supportLevel ?? existing?.supportLevel ?? 'fallback',
      supportNote: patch.supportNote ?? existing?.supportNote,
      updatedAt: Date.now(),
    };
  },
  computeMissing(state, phase) {
    if (state.inferredType === 'unknown') {
      return {
        critical: ['inferredType'],
        optional: [],
      };
    }
    return computeLegacyMissing(state, phase, [...GENERIC_ALLOWED_KEYS]);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildGenericQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildGenericDefaultProposals(keys, state, locale);
  },
  buildReportNarrative(input: SkillReportNarrativeInput) {
    return buildDefaultReportNarrative(input);
  },
  buildModel(state) {
    if (state.inferredType === 'unknown') {
      return undefined;
    }
    const criticalMissing = computeMissingCriticalKeys(state);
    return criticalMissing.length === 0 ? buildLegacyModel(state) ?? buildFallbackModel(state) : undefined;
  },
  resolveStage(missingKeys, state) {
    if (state.inferredType === 'unknown') {
      return 'intent';
    }
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
