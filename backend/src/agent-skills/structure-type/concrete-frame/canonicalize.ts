import { mergeDraftPatchWithSupplemental } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftFloorLoad, EngineeringDraftLoad } from '../../../agent-runtime/types.js';
import type { ConcreteFramePatchSources } from './types.js';

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
): boolean {
  return Boolean(
    patch.bayCountY !== undefined
    || (patch.bayWidthsYM?.length ?? 0) > 0
    || hasLateralYFloorLoad(floorLoads),
  );
}

export function resolveConcreteFrameDimension(
  patch: DraftExtraction,
  existingState: ConcreteFramePatchSources['existingState'],
  floorLoads: DraftFloorLoad[] | undefined = patch.floorLoads,
): '2d' | '3d' | undefined {
  if (patch.frameDimension === '3d') {
    return '3d';
  }
  if (hasConcreteFrameYEvidence(patch, floorLoads)) {
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

  next.frameDimension = resolveConcreteFrameDimension(next, input.existingState, floorLoads);
  return fillConcreteFrameDimensionSpecificGeometry(next);
}
