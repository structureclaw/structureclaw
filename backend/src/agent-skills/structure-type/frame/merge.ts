import { mergeLegacyState } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';
import { coerceFrameDimension, toFramePatch } from './extract-llm.js';

export function mergeFrameState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const domainMerged = mergeLegacyState(
    existing,
    coerceFrameDimension(toFramePatch(patch), existing, ''),
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
