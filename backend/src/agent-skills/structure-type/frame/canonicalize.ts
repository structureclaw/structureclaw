import { mergeDraftPatchWithSupplemental } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftFloorLoad, EngineeringDraftLoad } from '../../../agent-runtime/types.js';
import type { FramePatchSources } from './types.js';

function isSemanticGravityLineLoad(load: EngineeringDraftLoad): boolean {
  return (load.kind === 'line' || load.kind === 'distributed' || load.unit === 'kN/m')
    && load.magnitude > 0
    && (load.direction === undefined || load.direction === 'gravity' || load.direction === 'globalZ');
}

export function hasSemanticGravityLineLoads(patch: Pick<DraftExtraction, 'engineeringDraft'>): boolean {
  return Boolean(patch.engineeringDraft?.loads?.some(isSemanticGravityLineLoad));
}

export function stripDeadFloorLoadValues(floorLoads: DraftFloorLoad[] | undefined): DraftFloorLoad[] | undefined {
  const preservedLoads: DraftFloorLoad[] = [];
  for (const load of floorLoads ?? []) {
    if (load.liveLoadKN === undefined && load.lateralXKN === undefined && load.lateralYKN === undefined) continue;
    const next: DraftFloorLoad = { story: load.story };
    if (load.liveLoadKN !== undefined) next.liveLoadKN = load.liveLoadKN;
    if (load.lateralXKN !== undefined) next.lateralXKN = load.lateralXKN;
    if (load.lateralYKN !== undefined) next.lateralYKN = load.lateralYKN;
    preservedLoads.push(next);
  }
  return preservedLoads.length ? preservedLoads : undefined;
}

export function mergeFloorLoadsByStory(
  existing: DraftFloorLoad[] | undefined,
  incoming: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!existing?.length) return incoming;
  if (!incoming?.length) return existing;

  const merged = new Map<number, DraftFloorLoad>();
  for (const load of existing) {
    merged.set(load.story, { ...load });
  }

  for (const load of incoming) {
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

export function hasLateralYFloorLoad(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return Boolean(floorLoads?.some((load) => load.lateralYKN !== undefined));
}

function hasFrameYEvidence(
  patch: DraftExtraction,
  floorLoads: DraftFloorLoad[] | undefined,
): boolean {
  return Boolean(
    patch.bayCountY !== undefined
    || (patch.bayWidthsYM?.length ?? 0) > 0
    || hasLateralYFloorLoad(floorLoads),
  );
}

export function resolveFrameDimension(
  patch: DraftExtraction,
  existingState: FramePatchSources['existingState'],
  floorLoads: DraftFloorLoad[] | undefined = patch.floorLoads,
): '2d' | '3d' | undefined {
  if (patch.frameDimension === '3d') {
    return '3d';
  }
  if (hasFrameYEvidence(patch, floorLoads)) {
    return '3d';
  }
  if (patch.frameDimension === '2d') {
    return '2d';
  }
  return existingState?.frameDimension ?? undefined;
}

export function fillFrameDimensionSpecificGeometry(patch: DraftExtraction): DraftExtraction {
  const next: DraftExtraction = { ...patch };

  if (next.storyCount === undefined && next.storyHeightsM?.length) {
    next.storyCount = next.storyHeightsM.length;
  }

  if (next.frameDimension === '2d' || next.frameDimension === undefined) {
    if (!next.bayWidthsM?.length && next.bayWidthsXM?.length && !next.bayWidthsYM?.length) {
      next.bayWidthsM = [...next.bayWidthsXM];
    }
    if (next.bayCount === undefined) {
      next.bayCount = next.bayWidthsM?.length
        ?? next.bayCountX
        ?? next.bayWidthsXM?.length;
    }
    if (next.frameDimension === '2d') return next;
  }

  if (next.frameDimension === '3d') {
    if (next.bayCountX === undefined && next.bayWidthsXM?.length) {
      next.bayCountX = next.bayWidthsXM.length;
    }
    if (next.bayCountY === undefined && next.bayWidthsYM?.length) {
      next.bayCountY = next.bayWidthsYM.length;
    }
  }

  return next;
}

export function canonicalizeFramePatch(input: FramePatchSources): DraftExtraction {
  const supplementalPatch = input.supplementalPatch ?? {};
  const llmPatch = input.llmPatch ?? {};
  const mergedPatch = mergeDraftPatchWithSupplemental(llmPatch, supplementalPatch);
  const next: DraftExtraction = {
    ...mergedPatch,
    inferredType: 'frame',
  };

  const shouldStripGravityFloorLoads = hasSemanticGravityLineLoads(mergedPatch);
  const floorLoads = mergeFloorLoadsByStory(
    input.existingState?.floorLoads,
    shouldStripGravityFloorLoads ? stripDeadFloorLoadValues(mergedPatch.floorLoads) : mergedPatch.floorLoads,
  );
  if (floorLoads) {
    next.floorLoads = floorLoads;
  }

  next.frameDimension = resolveFrameDimension(next, input.existingState, floorLoads);
  return fillFrameDimensionSpecificGeometry(next);
}
