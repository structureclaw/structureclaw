import { mergeLegacyDraftPatchLlmFirst } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftFloorLoad } from '../../../agent-runtime/types.js';
import type { ConcreteFramePatchSources } from './types.js';

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
    if (load.story === undefined) continue;
    
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

function hasConcreteFrameYEvidence(
  patch: DraftExtraction,
  floorLoads: DraftFloorLoad[] | undefined,
  message: string,
): boolean {
  return Boolean(
    patch.bayCountY !== undefined
    || (patch.bayWidthsYM?.length ?? 0) > 0
    || hasLateralYFloorLoad(floorLoads)
    || /(?:3d|三维|[yz]向|[yz]方向|x、[yz]向|x\/[yz]向)/i.test(message),
  );
}

export function resolveConcreteFrameDimension(
  patch: DraftExtraction,
  existingState: ConcreteFramePatchSources['existingState'],
  message: string,
  floorLoads: DraftFloorLoad[] | undefined = patch.floorLoads,
): '2d' | '3d' | undefined {
  if (patch.frameDimension === '3d') {
    return '3d';
  }
  if (hasConcreteFrameYEvidence(patch, floorLoads, message)) {
    return '3d';
  }
  if (patch.frameDimension === '2d') {
    return '2d';
  }
  return existingState?.frameDimension ?? undefined;
}

export function fillConcreteFrameDimensionSpecificGeometry(patch: DraftExtraction): DraftExtraction {
  // Track modified fields using local variables, reconstruct at return (M5: immutable style)
  let { storyCount, storyHeightsM, bayWidthsM } = patch;
  let { bayCount, bayCountX, bayCountY, bayWidthsXM, bayWidthsYM } = patch;
  const { frameDimension } = patch;

  if (storyCount === undefined && storyHeightsM?.length) {
    storyCount = storyHeightsM.length;
  }

  // Expand storyHeightsM to match storyCount when it represents a uniform value
  // e.g., [4.2] with storyCount=3 becomes [4.2, 4.2, 4.2]
  if (storyCount !== undefined && storyHeightsM?.length === 1) {
    const uniformHeight = storyHeightsM[0];
    if (uniformHeight !== undefined) {
      storyHeightsM = Array(storyCount).fill(uniformHeight);
    }
  }

  if (frameDimension === '2d' || frameDimension === undefined) {
    if (!bayWidthsM?.length && bayWidthsXM?.length && !bayWidthsYM?.length) {
      bayWidthsM = [...bayWidthsXM];
    }
    if (bayCount === undefined) {
      bayCount = bayWidthsM?.length
        ?? bayCountX
        ?? bayWidthsXM?.length;
    }
    if (frameDimension === '2d') {
      return { ...patch, storyCount, storyHeightsM, bayWidthsM, bayCount };
    }
  }

  if (frameDimension === '3d') {
    // M2: When user provides directionless bayWidthsM in 3D mode, copy to both directions
    if (bayWidthsM?.length && !bayWidthsXM?.length && !bayWidthsYM?.length) {
      bayWidthsXM = [...bayWidthsM];
      bayWidthsYM = [...bayWidthsM];
    }
    if (bayCountX === undefined && bayWidthsXM?.length) {
      bayCountX = bayWidthsXM.length;
    }
    if (bayCountY === undefined && bayWidthsYM?.length) {
      bayCountY = bayWidthsYM.length;
    }
    // Expand bayWidthsXM to match bayCountX when it represents uniform values
    if (bayCountX !== undefined && bayWidthsXM?.length === 1) {
      const uniformWidth = bayWidthsXM[0];
      if (uniformWidth !== undefined) {
        bayWidthsXM = Array(bayCountX).fill(uniformWidth);
      }
    }
    // Expand bayWidthsYM to match bayCountY when it represents uniform values
    if (bayCountY !== undefined && bayWidthsYM?.length === 1) {
      const uniformWidth = bayWidthsYM[0];
      if (uniformWidth !== undefined) {
        bayWidthsYM = Array(bayCountY).fill(uniformWidth);
      }
    }
  }

  // Reconstruct with spread to ensure immutability
  return {
    ...patch,
    storyCount,
    storyHeightsM,
    bayWidthsM,
    bayCount,
    bayCountX,
    bayCountY,
    bayWidthsXM,
    bayWidthsYM,
    frameDimension,
  };
}

export function canonicalizeConcreteFramePatch(input: ConcreteFramePatchSources): DraftExtraction {
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

  next.frameDimension = resolveConcreteFrameDimension(next, input.existingState, input.message, floorLoads);
  return fillConcreteFrameDimensionSpecificGeometry(next);
}
