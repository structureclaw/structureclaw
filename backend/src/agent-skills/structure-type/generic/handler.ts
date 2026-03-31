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

function extractNumber(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractDirectionalLoadNumber(text: string, axis: 'x' | 'y'): number | undefined {
  const axisToken = axis === 'x' ? 'x' : 'y';
  return extractNumber(text, [
    new RegExp(`(?:水平|横向|侧向)?${axisToken}(?:方向|向)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是|改成)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}方向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是|改成)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是|改成)?[^\\n]{0,24}?${axisToken}向\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是|改成)?[^\\n]{0,24}?${axisToken}方向\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}向\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}方向\\s*(\\d+(?:\\.\\d+)?)\\s*(?:kn|千牛)`, 'i'),
  ]);
}

function shouldMirrorHorizontalLoadToBothAxes(
  text: string,
  frameDimension: DraftState['frameDimension'] | undefined,
): boolean {
  if (frameDimension !== '3d') {
    return false;
  }
  return (
    text.includes('水平方向荷载')
    || text.includes('水平荷载都是')
    || text.includes('水平荷载均为')
    || text.includes('横向荷载两个方向')
    || text.includes('侧向荷载两个方向')
    || text.includes('两个方向都是')
    || text.includes('horizontal loads')
  );
}

function buildCarryoverFloorLoads(
  message: string,
  currentState: DraftState | undefined,
): DraftExtraction['floorLoads'] {
  if (currentState?.inferredType !== 'frame') {
    return undefined;
  }
  const storyCount = currentState.storyCount ?? currentState.storyHeightsM?.length;
  if (!storyCount || storyCount <= 0) {
    return undefined;
  }
  const text = message.toLowerCase();
  const dualLateralLoadKN = extractNumber(text, [
    /x(?:、|\/|和|及)\s*y向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|为|是|改成)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
  ]);
  const verticalLoadKN = extractNumber(text, [
    /(?:每层|各层)(?:节点)?(?:竖向)?荷载(?:都?是|均为|为|是|改成)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /(?:每层|各层)竖向(?:都?是|均为|为|是|改成)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
  ]);
  const extractedLateralX = dualLateralLoadKN ?? extractNumber(text, [
    /(?:横向|侧向|水平)(?:方向)?荷载(?:两个方向)?(?:都?是|均为|都为|为|是|改成)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /水平方向荷载(?:都?是|均为|为|是|改成)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
    /(?:横向|侧向|水平)荷载(?:都?是|均为|为|是|改成)?\s*(\d+(?:\.\d+)?)\s*(?:kn|千牛)/i,
  ]) ?? extractDirectionalLoadNumber(text, 'x');
  const extractedLateralY = dualLateralLoadKN ?? extractDirectionalLoadNumber(text, 'y');
  const isReplacementUpdate = /改成|改为|调整为|更新为|改到/.test(message);
  const mentionsXDirection = /x方向|x向/i.test(text);
  const mentionsYDirection = /y方向|y向/i.test(text);
  const mirroredY = shouldMirrorHorizontalLoadToBothAxes(text, currentState.frameDimension) ? extractedLateralX : undefined;
  const lateralY = extractedLateralY
    ?? mirroredY
    ?? (isReplacementUpdate && mentionsXDirection && !mentionsYDirection && currentState.frameDimension === '3d' ? 0 : undefined);
  const lateralX = extractedLateralX
    ?? (isReplacementUpdate && mentionsYDirection && !mentionsXDirection ? 0 : undefined);

  if (verticalLoadKN === undefined && lateralX === undefined && lateralY === undefined) {
    return undefined;
  }

  return Array.from({ length: storyCount }, (_, index) => ({
    story: index + 1,
    verticalKN: verticalLoadKN,
    lateralXKN: lateralX,
    lateralYKN: currentState.frameDimension === '3d' ? lateralY : undefined,
  }));
}

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
  const merged = mergeLegacyDraftPatchLlmFirst(
    normalizeLegacyDraftPatch(llmDraftPatch),
    extractDraftByRules(message),
  );
  const normalizedMessage = message.toLowerCase();

  if (currentState?.inferredType === 'frame') {
    const floorLoads = merged.floorLoads ?? buildCarryoverFloorLoads(message, currentState);
    return {
      ...merged,
      inferredType: 'frame',
      structuralTypeKey: currentState.structuralTypeKey ?? 'frame',
      frameDimension: merged.frameDimension ?? currentState.frameDimension,
      storyCount: merged.storyCount ?? currentState.storyCount,
      storyHeightsM: merged.storyHeightsM ?? currentState.storyHeightsM,
      bayCount: merged.bayCount ?? currentState.bayCount,
      bayCountX: merged.bayCountX ?? currentState.bayCountX,
      bayCountY: merged.bayCountY ?? currentState.bayCountY,
      bayWidthsM: merged.bayWidthsM ?? currentState.bayWidthsM,
      bayWidthsXM: merged.bayWidthsXM ?? currentState.bayWidthsXM,
      bayWidthsYM: merged.bayWidthsYM ?? currentState.bayWidthsYM,
      floorLoads,
    };
  }

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
      const upgradedDraft = buildGenericPatch(message, null, currentState);
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
