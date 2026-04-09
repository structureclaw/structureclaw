import type { DraftExtraction, DraftFloorLoad } from '../../../agent-runtime/types.js';
import type { FramePatchSources } from './types.js';

function mergeFloorLoadsByStory(
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

export function canonicalizeFramePatch(input: FramePatchSources): DraftExtraction {
  const naturalPatch = input.naturalPatch ?? {};
  const llmPatch = input.llmPatch ?? {};
  const next: DraftExtraction = {
    ...naturalPatch,
    ...llmPatch,
    inferredType: 'frame',
  };

  const floorLoads = mergeFloorLoadsByStory(
    input.existingState?.floorLoads,
    mergeFloorLoadsByStory(naturalPatch.floorLoads, llmPatch.floorLoads),
  );
  if (floorLoads) {
    next.floorLoads = floorLoads;
  }

  const hasYEvidence = Boolean(
    next.bayCountY !== undefined
    || (next.bayWidthsYM?.length ?? 0) > 0
    || floorLoads?.some((load) => load.lateralYKN !== undefined)
    || /(?:3d|三维|y向|y方向|x、y向|x\/y向)/i.test(input.message),
  );

  if (hasYEvidence) {
    next.frameDimension = '3d';
  } else if (next.frameDimension === undefined) {
    next.frameDimension = input.existingState?.frameDimension ?? '2d';
  }

  if (next.storyCount === undefined && next.storyHeightsM?.length) {
    next.storyCount = next.storyHeightsM.length;
  }

  if (next.frameDimension === '2d' && next.bayCount === undefined && next.bayWidthsM?.length) {
    next.bayCount = next.bayWidthsM.length;
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
