import {
  mergeDraftState,
  normalizeFloorLoads,
  normalizeFrameBaseSupportType,
  normalizeFrameDimension,
  normalizeInferredType,
  normalizeLoadPosition,
  normalizeLoadPositionM,
  normalizeLoadType,
  normalizeNumber,
  normalizeNumberArray,
  normalizePositiveInteger,
  normalizeSupportType,
} from './fallback.js';
import { buildModel } from './model-builder.js';
import {
  computeMissingCriticalKeys,
  computeMissingLoadDetailKeys,
  mapMissingFieldLabels,
} from './draft-guidance.js';
import {
  STRUCTURAL_COORDINATE_SEMANTICS,
  stampDraftSemantics,
} from './coordinate-semantics.js';
import type { AppLocale } from '../services/locale.js';
import type { DraftExtraction, DraftFloorLoad, DraftState, InferredModelType } from './types.js';

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
    loadPositionM: normalizeLoadPositionM(patch.loadPositionM),
  };
}

function mergeFloorLoadsLlmFirst(
  llmFloorLoads: DraftFloorLoad[] | undefined,
  ruleFloorLoads: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!llmFloorLoads?.length) {
    return ruleFloorLoads?.length ? [...ruleFloorLoads].sort((left, right) => left.story - right.story) : undefined;
  }
  if (!ruleFloorLoads?.length) {
    return [...llmFloorLoads].sort((left, right) => left.story - right.story);
  }

  const merged = new Map<number, DraftFloorLoad>();
  for (const load of ruleFloorLoads) {
    merged.set(load.story, { ...load });
  }
  for (const load of llmFloorLoads) {
    const current = merged.get(load.story);
    merged.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? current?.verticalKN,
      liveLoadKN: load.liveLoadKN ?? current?.liveLoadKN,
      lateralXKN: load.lateralXKN ?? current?.lateralXKN,
      lateralYKN: load.lateralYKN ?? current?.lateralYKN,
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.story - right.story);
}

export function mergeLegacyDraftPatchLlmFirst(
  llmPatch: DraftExtraction,
  rulePatch: DraftExtraction,
): DraftExtraction {
  const nextPatch: DraftExtraction = {};
  const keys = new Set<string>([
    ...Object.keys(rulePatch),
    ...Object.keys(llmPatch),
  ]);

  for (const key of keys) {
    if (key === 'floorLoads') {
      nextPatch.floorLoads = mergeFloorLoadsLlmFirst(llmPatch.floorLoads, rulePatch.floorLoads);
      continue;
    }
    const llmValue = llmPatch[key];
    if (llmValue !== undefined) {
      nextPatch[key] = llmValue;
      continue;
    }
    const ruleValue = rulePatch[key];
    if (ruleValue !== undefined) {
      nextPatch[key] = ruleValue;
    }
  }

  return nextPatch;
}

export function buildLegacyDraftPatchLlmFirst(
  _message: string,
  llmDraftPatch: Record<string, unknown> | null | undefined,
): DraftExtraction {
  return normalizeLegacyDraftPatch(llmDraftPatch);
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
  return stampDraftSemantics({
    ...merged,
    inferredType,
    skillId,
    structuralTypeKey: (merged.structuralTypeKey ?? skillId) as DraftState['structuralTypeKey'],
    updatedAt: Date.now(),
  });
}

export function computeLegacyMissing(
  state: DraftState,
  phase: 'interactive' | 'execution',
  allowedKeys: string[],
): { critical: string[]; optional: string[] } {
  const allowed = new Set(allowedKeys);
  const critical = computeMissingCriticalKeys(state).filter((key) => allowed.has(key));
  if (phase === 'interactive') {
    critical.push(...computeMissingLoadDetailKeys(state).filter((key) => allowed.has(key) && !critical.includes(key)));
  }
  return { critical, optional: [] };
}

export function buildLegacyLabels(keys: string[], locale: AppLocale): string[] {
  return mapMissingFieldLabels(keys, locale);
}

export function buildLegacyModel(state: DraftState): Record<string, unknown> | undefined {
  const missing = computeMissingCriticalKeys(state);
  if (missing.length > 0) {
    return undefined;
  }
  const model = buildModel(state);
  if (model) {
    const meta = model.metadata as Record<string, unknown>;
    meta.coordinateSemantics = STRUCTURAL_COORDINATE_SEMANTICS;
  }
  return model;
}
