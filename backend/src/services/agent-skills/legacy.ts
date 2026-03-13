import {
  buildInteractionQuestions,
  buildModel,
  computeMissingCriticalKeys,
  computeMissingLoadDetailKeys,
  extractDraftByRules,
  mapMissingFieldLabels,
  mergeDraftExtraction,
  mergeDraftState,
  normalizeFloorLoads,
  normalizeFrameBaseSupportType,
  normalizeFrameDimension,
  normalizeInferredType,
  normalizeLoadPosition,
  normalizeLoadType,
  normalizeNumber,
  normalizeNumberArray,
  normalizePositiveInteger,
  normalizeSupportType,
} from './fallback.js';
import type { AppLocale } from '../locale.js';
import type { DraftExtraction, DraftState, InferredModelType, InteractionQuestion } from './types.js';

export function normalizeLegacyDraftPatch(patch: Record<string, unknown> | null | undefined): DraftExtraction {
  if (!patch) {
    return {};
  }
  return {
    inferredType: normalizeInferredType(patch.inferredType),
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
  };
}

export function buildLegacyDraftPatch(message: string, llmDraftPatch: Record<string, unknown> | null | undefined): DraftExtraction {
  return mergeDraftExtraction(
    normalizeLegacyDraftPatch(llmDraftPatch),
    extractDraftByRules(message),
  );
}

export function restrictLegacyDraftPatch(
  patch: DraftExtraction,
  inferredType: InferredModelType,
  allowedKeys: string[],
): DraftExtraction {
  const nextPatch: DraftExtraction = { inferredType };
  for (const key of allowedKeys) {
    if (patch[key] !== undefined) {
      nextPatch[key] = patch[key];
    }
  }
  return nextPatch;
}

export function mergeLegacyState(existing: DraftState | undefined, patch: DraftExtraction, inferredType: InferredModelType, skillId: string): DraftState {
  const merged = mergeDraftState(existing, { ...patch, inferredType });
  return {
    ...merged,
    inferredType,
    skillId,
    scenarioKey: (merged.scenarioKey ?? skillId) as DraftState['scenarioKey'],
    updatedAt: Date.now(),
  };
}

export function computeLegacyMissing(
  state: DraftState,
  mode: 'chat' | 'execute',
  allowedKeys: string[],
): { critical: string[]; optional: string[] } {
  const allowed = new Set(allowedKeys);
  const critical = computeMissingCriticalKeys(state).filter((key) => allowed.has(key));
  if (mode === 'chat') {
    critical.push(...computeMissingLoadDetailKeys(state).filter((key) => allowed.has(key) && !critical.includes(key)));
  }
  return { critical, optional: [] };
}

export function buildLegacyQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  return buildInteractionQuestions(keys, criticalMissing, state, locale);
}

export function buildLegacyLabels(keys: string[], locale: AppLocale): string[] {
  return mapMissingFieldLabels(keys, locale);
}

export function buildLegacyModel(state: DraftState): Record<string, unknown> | undefined {
  const missing = computeMissingCriticalKeys(state);
  if (missing.length > 0) {
    return undefined;
  }
  return buildModel(state);
}
