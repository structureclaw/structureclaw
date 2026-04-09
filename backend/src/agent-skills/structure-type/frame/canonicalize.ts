import { mergeLegacyDraftPatchLlmFirst } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftFloorLoad } from '../../../agent-runtime/types.js';
import type { FramePatchSources } from './types.js';

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
  message: string,
): boolean {
  return Boolean(
    patch.bayCountY !== undefined
    || (patch.bayWidthsYM?.length ?? 0) > 0
    || hasLateralYFloorLoad(floorLoads)
    || /(?:3d|三维|y向|y方向|x、y向|x\/y向)/i.test(message),
  );
}

export function resolveFrameDimension(
  patch: DraftExtraction,
  existingState: FramePatchSources['existingState'],
  message: string,
  floorLoads: DraftFloorLoad[] | undefined = patch.floorLoads,
): '2d' | '3d' | undefined {
  if (patch.frameDimension === '3d') {
    return '3d';
  }
  if (hasFrameYEvidence(patch, floorLoads, message)) {
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
  const naturalPatch = input.naturalPatch ?? {};
  const llmPatch = input.llmPatch ?? {};
  const mergedPatch = mergeLegacyDraftPatchLlmFirst(llmPatch, naturalPatch);
  const next: DraftExtraction = {
    ...mergedPatch,
    inferredType: 'frame',
  };

  const floorLoads = mergeFloorLoadsByStory(
    input.existingState?.floorLoads,
    mergedPatch.floorLoads,
  );
  if (floorLoads) {
    next.floorLoads = floorLoads;
  }

  next.frameDimension = resolveFrameDimension(next, input.existingState, input.message, floorLoads);
  return fillFrameDimensionSpecificGeometry(next);
}
