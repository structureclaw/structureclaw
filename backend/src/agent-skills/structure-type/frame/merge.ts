import { mergeLegacyState } from '../../../agent-runtime/legacy.js';
import {
  hasIncompleteFramePointLoadLocation,
  isLocalizedFramePointLoad,
} from '../../../agent-runtime/engineering-draft.js';
import type {
  DraftExtraction,
  DraftState,
  EngineeringDraftLoad,
} from '../../../agent-runtime/types.js';
import {
  FRAME_NODAL_LOAD_LOCATION_FIELD,
  coerceFrameDimension,
  toFramePatch,
} from './extract-llm.js';

function isLocationCorrection(
  existingLoad: EngineeringDraftLoad,
  incomingLoad: EngineeringDraftLoad,
): boolean {
  if (!hasIncompleteFramePointLoadLocation(existingLoad) || !isLocalizedFramePointLoad(incomingLoad)) {
    return false;
  }
  return existingLoad.kind === incomingLoad.kind
    && existingLoad.unit === incomingLoad.unit
    && existingLoad.direction === incomingLoad.direction
    && (!existingLoad.target
      || !incomingLoad.target
      || existingLoad.target.trim().toLowerCase() === incomingLoad.target.trim().toLowerCase())
    && (existingLoad.location?.story === undefined
      || existingLoad.location.story === incomingLoad.location?.story)
    && (!existingLoad.location?.nodeRole
      || existingLoad.location.nodeRole === incomingLoad.location?.nodeRole);
}

function withoutSupersededIncompleteLoads(
  existing: DraftState | undefined,
  patch: DraftExtraction,
): DraftState | undefined {
  const incomingLoads = patch.engineeringDraft?.loads ?? [];
  if (!existing?.engineeringDraft?.loads?.length || !incomingLoads.some(isLocalizedFramePointLoad)) {
    return existing;
  }
  const loads = existing.engineeringDraft.loads.filter((existingLoad) => (
    !incomingLoads.some((incomingLoad) => isLocationCorrection(existingLoad, incomingLoad))
  ));
  if (loads.length === existing.engineeringDraft.loads.length) return existing;
  return {
    ...existing,
    engineeringDraft: {
      ...existing.engineeringDraft,
      loads: loads.length ? loads : undefined,
    },
  };
}

function clearResolvedNodalLocationIssue(state: DraftState): DraftState {
  if (state.engineeringDraft?.loads?.some(hasIncompleteFramePointLoadLocation)) {
    return state;
  }
  const draftIssues = state.draftIssues
    ?.filter((issue) => issue.field !== FRAME_NODAL_LOAD_LOCATION_FIELD);
  const invalidDraftFields = Array.isArray(state.skillState?.invalidDraftFields)
    ? state.skillState.invalidDraftFields.filter((field) => field !== FRAME_NODAL_LOAD_LOCATION_FIELD)
    : undefined;
  const skillState = state.skillState
    ? {
      ...state.skillState,
      ...(invalidDraftFields?.length ? { invalidDraftFields } : {}),
    }
    : undefined;
  if (skillState && !invalidDraftFields?.length) {
    delete skillState.invalidDraftFields;
  }
  return {
    ...state,
    draftIssues: draftIssues?.length ? draftIssues : undefined,
    skillState: skillState && Object.keys(skillState).length ? skillState : undefined,
  };
}

export function mergeFrameState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const existingForMerge = withoutSupersededIncompleteLoads(existing, patch);
  const domainMerged = mergeLegacyState(
    existingForMerge,
    coerceFrameDimension(toFramePatch(patch), existingForMerge),
    'frame',
    'frame',
  );

  return clearResolvedNodalLocationIssue({
    ...domainMerged,
    frameMaterial: (patch.frameMaterial as string | undefined) ?? (existingForMerge?.frameMaterial as string | undefined),
    frameColumnSection: (patch.frameColumnSection as string | undefined) ?? (existingForMerge?.frameColumnSection as string | undefined),
    frameBeamSection: (patch.frameBeamSection as string | undefined) ?? (existingForMerge?.frameBeamSection as string | undefined),
    wind: patch.wind !== undefined
      ? { ...(existingForMerge?.wind ?? {}), ...patch.wind }
      : existingForMerge?.wind,
  });
}
