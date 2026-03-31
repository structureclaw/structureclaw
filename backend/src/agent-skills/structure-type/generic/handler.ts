import {
  buildLegacyDraftPatchLlmFirst,
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyDraftPatchLlmFirst,
  normalizeLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import {
  buildInteractionQuestions as buildFallbackInteractionQuestions,
  buildModel as buildFallbackModel,
  computeMissingCriticalKeys,
  extractDraftByRules,
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
): DraftExtraction {
  const merged = mergeLegacyDraftPatchLlmFirst(
    normalizeLegacyDraftPatch(llmDraftPatch),
    extractDraftByRules(message),
  );
  const normalizedMessage = message.toLowerCase();

  if (!merged.inferredType || merged.inferredType === 'unknown') {
    if (normalizedMessage.includes('steel frame') || message.includes('钢框架')) {
      return {
        ...merged,
        inferredType: 'frame',
        structuralTypeKey: 'steel-frame',
      };
    }
    if (
      normalizedMessage.includes('3d frame')
      || normalizedMessage.includes('space frame')
      || message.includes('三维框架')
      || message.includes('空间框架')
      || normalizedMessage.includes('frame')
      || message.includes('框架')
    ) {
      return {
        ...merged,
        inferredType: 'frame',
        structuralTypeKey: 'frame',
      };
    }
    if (normalizedMessage.includes('portal frame') || message.includes('门式刚架') || message.includes('门架') || message.includes('刚架')) {
      return {
        ...merged,
        inferredType: 'portal-frame',
        structuralTypeKey: 'portal-frame',
      };
    }
    if (normalizedMessage.includes('truss') || message.includes('桁架')) {
      return {
        ...merged,
        inferredType: 'truss',
        structuralTypeKey: 'truss',
      };
    }
    if (normalizedMessage.includes('beam') || normalizedMessage.includes('girder') || message.includes('梁')) {
      return {
        ...merged,
        inferredType: 'beam',
        structuralTypeKey: 'beam',
      };
    }
  }

  return merged;
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
  return buildFallbackInteractionQuestions(keys, criticalMissing, state, locale);
}

export const handler: SkillHandler = {
  detectStructuralType({ message, locale, currentState }) {
    if (currentState?.skillId === 'generic') {
      const upgradedDraft = buildGenericPatch(message, null);
      const upgradedInferredType = upgradedDraft.inferredType ?? 'unknown';
      const upgradedScenarioKey = upgradedDraft.structuralTypeKey ?? (upgradedInferredType === 'unknown' ? 'unknown' : upgradedInferredType);
      const canUpgradeCurrentUnknown = currentState.inferredType === 'unknown' && upgradedInferredType !== 'unknown';
      return buildStructuralTypeMatch(
        canUpgradeCurrentUnknown ? upgradedScenarioKey : (currentState.structuralTypeKey ?? 'unknown'),
        canUpgradeCurrentUnknown ? upgradedInferredType : currentState.inferredType,
        'generic',
        currentState.supportLevel ?? 'fallback',
        locale,
        {
          zh: canUpgradeCurrentUnknown
            ? '继续使用通用结构类型 skill 处理当前对话，并根据新补充的信息更新结构类型。'
            : '继续使用通用结构类型 skill 处理当前对话。'
            ,
          en: canUpgradeCurrentUnknown
            ? 'Continue using the generic structure-type skill and upgrade the structural type with the newly provided details.'
            : 'Continue using the generic structure-type skill for the current conversation.',
        },
      );
    }

    if (!hasStructuralIntent(message)) {
      return null;
    }

    const draft = buildGenericPatch(message, null);
    const inferred = draft.inferredType ?? 'unknown';
    const key = draft.structuralTypeKey ?? (inferred === 'unknown' ? 'unknown' : inferred);
    return buildStructuralTypeMatch(key, inferred, 'generic', 'fallback', locale, {
      zh: inferred === 'unknown'
        ? '已切换到通用结构类型 skill，先接住当前问题并继续补参。'
        : '未命中更专门的结构类型 skill，已切换到通用结构类型 skill 继续处理。',
      en: inferred === 'unknown'
        ? 'Switched to the generic structure-type skill to catch the request and continue clarification.'
        : 'No more specialized structure-type skill matched, so the generic structure-type skill will continue the workflow.',
    });
  },
  parseProvidedValues(values) {
    return normalizeLegacyDraftPatch(values);
  },
  extractDraft({ message, llmDraftPatch }) {
    return buildGenericPatch(message, llmDraftPatch);
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
