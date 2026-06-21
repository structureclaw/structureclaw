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
import { normalizeEngineeringDraft as normalizeSemanticEngineeringDraft } from './engineering-draft.js';
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
import type { DraftExtraction, DraftFloorLoad, DraftIssue, DraftState, InferredModelType } from './types.js';

function normalizeSkillState(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeDraftIssues(value: unknown): DraftIssue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const issues = value
    .map((item): DraftIssue | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const severity = record.severity;
      const reason = record.reason;
      if (
        severity !== 'invalid'
        && severity !== 'ambiguous'
        && severity !== 'unrealistic'
        && severity !== 'conflict'
      ) {
        return null;
      }
      if (typeof reason !== 'string' || !reason.trim()) {
        return null;
      }
      return {
        ...(typeof record.field === 'string' && record.field.trim() ? { field: record.field.trim() } : {}),
        ...(record.value !== undefined ? { value: record.value } : {}),
        severity,
        reason: reason.trim(),
        ...(typeof record.question === 'string' && record.question.trim() ? { question: record.question.trim() } : {}),
      };
    })
    .filter((item): item is DraftIssue => item !== null);
  return issues.length ? issues : undefined;
}

function pushUnique(values: string[], key: string): void {
  if (!values.includes(key)) {
    values.push(key);
  }
}

function invalidIfNonPositive(patch: Record<string, unknown>, key: string, invalid: string[]): void {
  if (!(key in patch)) {
    return;
  }
  const parsed = normalizeNumber(patch[key]);
  if (parsed !== undefined && parsed <= 0) {
    pushUnique(invalid, key);
  }
}

function invalidIfArrayHasNonPositive(patch: Record<string, unknown>, key: string, invalid: string[]): void {
  const value = patch[key];
  if (!Array.isArray(value)) {
    return;
  }
  const hasInvalid = value.some((item) => {
    const parsed = normalizeNumber(item);
    return parsed !== undefined && parsed <= 0;
  });
  if (hasInvalid) {
    pushUnique(invalid, key);
  }
}

function collectEngineeringDraftInvalidFields(engineeringDraft: unknown, invalid: string[]): void {
  if (!engineeringDraft || typeof engineeringDraft !== 'object' || Array.isArray(engineeringDraft)) {
    return;
  }
  const draft = engineeringDraft as Record<string, unknown>;
  const geometry = draft.geometry;
  if (geometry && typeof geometry === 'object' && !Array.isArray(geometry)) {
    const rawGeometry = geometry as Record<string, unknown>;
    invalidIfNonPositive(rawGeometry, 'lengthM', invalid);
    invalidIfNonPositive(rawGeometry, 'heightM', invalid);
    invalidIfArrayHasNonPositive(rawGeometry, 'spanLengthsM', invalid);
    invalidIfArrayHasNonPositive(rawGeometry, 'storyHeightsM', invalid);
    invalidIfArrayHasNonPositive(rawGeometry, 'bayWidthsM', invalid);
    invalidIfArrayHasNonPositive(rawGeometry, 'bayWidthsXM', invalid);
    invalidIfArrayHasNonPositive(rawGeometry, 'bayWidthsYM', invalid);
  }
  if (Array.isArray(draft.loads)) {
    const hasInvalidLoad = draft.loads.some((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const record = item as Record<string, unknown>;
      const parsed = normalizeNumber(record.magnitude ?? record.value ?? record.loadKN ?? record.forceKN ?? record.intensity);
      return parsed !== undefined && parsed <= 0;
    });
    if (hasInvalidLoad) {
      pushUnique(invalid, 'loadKN');
    }
  }
}

function collectInvalidDraftFields(patch: Record<string, unknown>): string[] | undefined {
  const invalid: string[] = [];
  for (const key of ['lengthM', 'spanLengthM', 'heightM', 'loadKN'] as const) {
    invalidIfNonPositive(patch, key, invalid);
  }
  for (const key of ['storyCount', 'bayCount', 'bayCountX', 'bayCountY'] as const) {
    invalidIfNonPositive(patch, key, invalid);
  }
  for (const key of ['storyHeightsM', 'bayWidthsM', 'bayWidthsXM', 'bayWidthsYM'] as const) {
    invalidIfArrayHasNonPositive(patch, key, invalid);
  }
  collectEngineeringDraftInvalidFields(patch.engineeringDraft, invalid);
  return invalid.length ? invalid : undefined;
}

function withInvalidDraftFields(
  skillState: Record<string, unknown> | undefined,
  invalidDraftFields: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!skillState && !invalidDraftFields?.length) {
    return undefined;
  }
  const existing = Array.isArray(skillState?.invalidDraftFields)
    ? skillState.invalidDraftFields.filter((field): field is string => typeof field === 'string')
    : [];
  const merged = Array.from(new Set([
    ...existing,
    ...(invalidDraftFields ?? []),
  ]));
  return {
    ...(skillState ?? {}),
    ...(merged.length ? { invalidDraftFields: merged } : {}),
  };
}

export function normalizeLegacyDraftPatch(patch: Record<string, unknown> | null | undefined): DraftExtraction {
  if (!patch) {
    return {};
  }
  const draftIssues = normalizeDraftIssues(patch.draftIssues);
  const issueFields = draftIssues
    ?.map((issue) => issue.field)
    .filter((field): field is string => typeof field === 'string' && field.trim().length > 0);
  const invalidDraftFields = Array.from(new Set([
    ...(collectInvalidDraftFields(patch) ?? []),
    ...(issueFields ?? []),
  ]));
  const skillState = withInvalidDraftFields(
    normalizeSkillState(patch.skillState),
    invalidDraftFields.length ? invalidDraftFields : undefined,
  );
  return {
    inferredType: normalizeInferredType(patch.inferredType),
    skillId: typeof patch.skillId === 'string' ? patch.skillId : undefined,
    engineeringDraft: normalizeSemanticEngineeringDraft(patch.engineeringDraft),
    draftIssues,
    skillState,
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

function mergeFloorLoadsWithSupplemental(
  llmFloorLoads: DraftFloorLoad[] | undefined,
  supplementalFloorLoads: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!llmFloorLoads?.length) {
    return supplementalFloorLoads?.length ? [...supplementalFloorLoads].sort((left, right) => left.story - right.story) : undefined;
  }
  if (!supplementalFloorLoads?.length) {
    return [...llmFloorLoads].sort((left, right) => left.story - right.story);
  }

  const merged = new Map<number, DraftFloorLoad>();
  for (const load of supplementalFloorLoads) {
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

function mergeSkillStateWithSupplemental(
  llmState: Record<string, unknown> | undefined,
  supplementalState: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!llmState && !supplementalState) {
    return undefined;
  }

  const llmInvalid = llmState?.invalidDraftFields;
  const supplementalInvalid = supplementalState?.invalidDraftFields;
  const invalidDraftFields = Array.isArray(llmInvalid) || Array.isArray(supplementalInvalid)
    ? Array.from(new Set([
      ...(Array.isArray(supplementalInvalid) ? supplementalInvalid : []),
      ...(Array.isArray(llmInvalid) ? llmInvalid : []),
    ].filter((field): field is string => typeof field === 'string')))
    : undefined;

  return {
    ...(supplementalState ?? {}),
    ...(llmState ?? {}),
    ...(invalidDraftFields ? { invalidDraftFields } : {}),
  };
}

export function mergeDraftPatchWithSupplemental(
  llmPatch: DraftExtraction,
  supplementalPatch: DraftExtraction,
): DraftExtraction {
  const nextPatch: DraftExtraction = {};
  const keys = new Set<string>([
    ...Object.keys(supplementalPatch),
    ...Object.keys(llmPatch),
  ]);

  for (const key of keys) {
    if (key === 'floorLoads') {
      nextPatch.floorLoads = mergeFloorLoadsWithSupplemental(llmPatch.floorLoads, supplementalPatch.floorLoads);
      continue;
    }
    if (key === 'skillState') {
      const skillState = mergeSkillStateWithSupplemental(llmPatch.skillState, supplementalPatch.skillState);
      if (skillState !== undefined) {
        nextPatch.skillState = skillState;
      }
      continue;
    }
    const llmValue = llmPatch[key];
    if (llmValue !== undefined) {
      nextPatch[key] = llmValue;
      continue;
    }
    const supplementalValue = supplementalPatch[key];
    if (supplementalValue !== undefined) {
      nextPatch[key] = supplementalValue;
    }
  }

  return nextPatch;
}

export function normalizeLlmDraftPatch(
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
  if (patch.engineeringDraft !== undefined) {
    nextPatch.engineeringDraft = patch.engineeringDraft;
  }
  if (patch.draftIssues !== undefined) {
    nextPatch.draftIssues = patch.draftIssues;
  }
  for (const key of allowedKeys) {
    if (patch[key] !== undefined) {
      nextPatch[key] = patch[key];
    }
  }
  if (patch.skillState !== undefined) {
    nextPatch.skillState = patch.skillState;
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
