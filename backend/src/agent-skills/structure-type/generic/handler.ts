import {
  buildModel as buildRuntimeModel,
  mergeDraftState,
  normalizeFloorLoads,
  normalizeFrameBaseSupportType,
  normalizeFrameDimension,
  normalizeLoadPosition,
  normalizeLoadPositionM,
  normalizeLoadType,
  normalizeNumber,
  normalizeNumberArray,
  normalizePositiveInteger,
  normalizeSupportType,
} from '../../../agent-runtime/fallback.js';
import {
  computeMissingCriticalKeys,
  computeMissingLoadDetailKeys,
  mapMissingFieldLabels,
} from '../../../agent-runtime/draft-guidance.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
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
  const merged = normalizeGenericDraftPatch(llmDraftPatch) || {};
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

function normalizeGenericDraftPatch(patch: Record<string, unknown> | null | undefined): DraftExtraction {
  if (!patch) {
    return {};
  }

  return {
    skillId: typeof patch.skillId === 'string' ? patch.skillId : undefined,
    lengthM: normalizeNumber(patch.lengthM),
    spanLengthM: normalizeNumber(patch.spanLengthM),
    heightM: normalizeNumber(patch.heightM),
    supportType: normalizeSupportType(patch.supportType),
    frameDimension: normalizeFrameDimension(patch.frameDimension),
    storyCount: normalizePositiveInteger(patch.storyCount),
    bayCount: normalizePositiveInteger(patch.bayCount),
    bayCountX: normalizePositiveInteger(patch.bayCountX),
    bayCountY: normalizePositiveInteger(patch.bayCountY),
    storyHeightsM: normalizeNumberArray(patch.storyHeightsM),
    bayWidthsM: normalizeNumberArray(patch.bayWidthsM),
    bayWidthsXM: normalizeNumberArray(patch.bayWidthsXM),
    bayWidthsYM: normalizeNumberArray(patch.bayWidthsYM),
    floorLoads: normalizeFloorLoads(patch.floorLoads),
    frameBaseSupportType: normalizeFrameBaseSupportType(patch.frameBaseSupportType),
    loadKN: normalizeNumber(patch.loadKN),
    loadType: normalizeLoadType(patch.loadType),
    loadPosition: normalizeLoadPosition(patch.loadPosition),
    loadPositionM: normalizeLoadPositionM(patch.loadPositionM),
  };
}

function computeGenericMissing(
  state: DraftState,
  phase: 'interactive' | 'execution',
  allowedKeys: readonly string[],
): { critical: string[]; optional: string[] } {
  const allowed = new Set(allowedKeys);
  const critical = computeMissingCriticalKeys(state).filter((key) => allowed.has(key));
  if (phase === 'interactive') {
    const loadDetails = computeMissingLoadDetailKeys(state).filter((key) => allowed.has(key) && !critical.includes(key));
    critical.push(...loadDetails);
  }
  return { critical, optional: [] };
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

  const labels = mapMissingFieldLabels(keys, locale);
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

function buildGenericReportNarrative(input: SkillReportNarrativeInput): string {
  const metricCount = Object.keys(input.keyMetrics || {}).length;
  if (input.locale === 'zh') {
    const lines = [
      '已完成通用结构流程的分析汇总。',
      `分析类型：${input.analysisType}。`,
      `执行状态：${input.analysisSuccess ? '成功' : '失败'}。`,
      input.summary ? `结果摘要：${input.summary}` : '结果摘要：请结合结构化结果查看详细信息。',
    ];
    if (metricCount > 0) {
      lines.push(`已提取 ${metricCount} 项关键指标，请结合结构化输出核对。`);
    }
    if (input.codeCheckText?.trim()) {
      lines.push('已包含规范校核文本结果。');
    }
    return lines.join('\n');
  }

  const lines = [
    'The generic structural workflow summary is complete.',
    `Analysis type: ${input.analysisType}.`,
    `Execution status: ${input.analysisSuccess ? 'success' : 'failed'}.`,
    input.summary
      ? `Summary: ${input.summary}`
      : 'Summary: review the structured outputs for detailed engineering values.',
  ];
  if (metricCount > 0) {
    lines.push(`${metricCount} key metric entries were extracted from the analysis output.`);
  }
  if (input.codeCheckText?.trim()) {
    lines.push('Code-check text output is included in this report context.');
  }
  return lines.join('\n');
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
    return normalizeGenericDraftPatch(values);
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
    return computeGenericMissing(state, phase, GENERIC_ALLOWED_KEYS);
  },
  mapLabels(keys, locale) {
    return mapMissingFieldLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildGenericQuestions(keys, criticalMissing, state, locale);
  },
  buildDefaultProposals(keys, state, locale) {
    return buildGenericDefaultProposals(keys, state, locale);
  },
  buildReportNarrative(input: SkillReportNarrativeInput) {
    return buildGenericReportNarrative(input);
  },
  buildModel(state) {
    if (state.inferredType === 'unknown') {
      return undefined;
    }
    const missing = computeGenericMissing(state, 'execution', GENERIC_ALLOWED_KEYS);
    return missing.critical.length === 0 ? buildRuntimeModel(state) : undefined;
  },
  resolveStage(missingKeys, state) {
    if (state.inferredType === 'unknown') {
      return 'intent';
    }
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
