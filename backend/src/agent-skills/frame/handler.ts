import {
  buildLegacyLabels,
  buildLegacyModel,
  buildLegacyQuestions,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../services/agent-skills/legacy.js';
import { buildScenarioMatch, resolveLegacyStructuralStage } from '../../services/agent-skills/plugin-helpers.js';
import { extractDraftByRules } from '../../services/agent-skills/fallback.js';
import type { DraftExtraction, DraftFloorLoad, DraftState, SkillHandler } from '../../services/agent-skills/types.js';

const ALLOWED_KEYS = [
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
] as const;

function toFramePatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch(patch, 'frame', [...ALLOWED_KEYS]);
}

function hasLateralYFloorLoad(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return Boolean(floorLoads?.some((load) => load.lateralYKN !== undefined));
}

function coerceFrameDimension(
  patch: DraftExtraction,
  existingState: DraftState | undefined,
  message: string,
): DraftExtraction {
  const text = message.toLowerCase();
  const mentions3dDirections = (
    text.includes('x、y向')
    || text.includes('x/y向')
    || text.includes('x 向') && text.includes('y 向')
    || text.includes('x向') && text.includes('y向')
    || text.includes('3d')
    || text.includes('三维')
  );
  const nextPatch: DraftExtraction = { ...patch };
  if (nextPatch.frameDimension === '3d' || hasLateralYFloorLoad(nextPatch.floorLoads)) {
    nextPatch.frameDimension = '3d';
    return nextPatch;
  }
  if (existingState?.frameDimension === '2d' && mentions3dDirections) {
    nextPatch.frameDimension = '3d';
    return nextPatch;
  }
  if (!nextPatch.frameDimension && existingState?.frameDimension) {
    nextPatch.frameDimension = existingState.frameDimension;
  }
  return nextPatch;
}

function buildFrameDraftPatch(
  message: string,
  llmDraftPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalizedLlmPatch = toFramePatch(normalizeLegacyDraftPatch(llmDraftPatch));
  const normalizedRulePatch = toFramePatch(extractDraftByRules(message));
  const nextPatch: DraftExtraction = {};

  for (const key of ALLOWED_KEYS) {
    const llmValue = normalizedLlmPatch[key];
    const ruleValue = normalizedRulePatch[key];
    if (llmValue !== undefined) {
      nextPatch[key as string] = llmValue;
      continue;
    }
    if (ruleValue !== undefined) {
      nextPatch[key as string] = ruleValue;
    }
  }

  return coerceFrameDimension(
    {
      ...nextPatch,
      inferredType: 'frame',
    },
    existingState,
    message,
  );
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (
      (text.includes('frame') || text.includes('框架') || text.includes('钢框架'))
      && (text.includes('irregular') || text.includes('不规则') || text.includes('退台') || text.includes('缺跨'))
    ) {
      return buildScenarioMatch('frame', 'unknown', 'frame', 'unsupported', locale, {
        zh: '当前 frame skill 只支持规则楼层和规则轴网框架。若结构存在退台、缺跨或明显不规则，请直接提供 JSON 或更具体的节点构件描述。',
        en: 'The current frame skill only supports regular stories and regular grids. If the structure has setbacks, missing bays, or strong irregularities, please provide JSON or a more explicit node/member description.',
      });
    }
    if (text.includes('steel frame') || text.includes('钢框架')) {
      return buildScenarioMatch('steel-frame', 'frame', 'frame', 'supported', locale);
    }
    if (text.includes('frame') || text.includes('框架')) {
      return buildScenarioMatch('frame', 'frame', 'frame', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return coerceFrameDimension(
      toFramePatch(normalizeLegacyDraftPatch(values)),
      undefined,
      JSON.stringify(values),
    );
  },
  extractDraft({ message, llmDraftPatch, currentState }) {
    return buildFrameDraftPatch(message, llmDraftPatch, currentState);
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, coerceFrameDimension(toFramePatch(patch), existing, ''), 'frame', 'frame');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing(
      { ...state, inferredType: 'frame' },
      mode,
      ['frameDimension', 'storyCount', 'bayCount', 'bayCountX', 'bayCountY', 'storyHeightsM', 'bayWidthsM', 'bayWidthsXM', 'bayWidthsYM', 'floorLoads']
    );
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildLegacyQuestions(keys, criticalMissing, { ...state, inferredType: 'frame' }, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'frame' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
