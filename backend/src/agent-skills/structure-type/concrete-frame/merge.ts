import { mergeLegacyState } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';
import { coerceConcreteFrameDimension, toConcreteFramePatch } from './extract-llm.js';

export function mergeConcreteFrameState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const domainMerged = mergeLegacyState(
    existing,
    coerceConcreteFrameDimension(toConcreteFramePatch(patch), existing, ''),
    'frame',
    'frame',
  );

  return {
    ...domainMerged,
    frameMaterial: (patch.frameMaterial as string | undefined) ?? (existing?.frameMaterial as string | undefined),
    frameColumnSection: (patch.frameColumnSection as string | undefined) ?? (existing?.frameColumnSection as string | undefined),
    frameBeamSection: (patch.frameBeamSection as string | undefined) ?? (existing?.frameBeamSection as string | undefined),
  };
}