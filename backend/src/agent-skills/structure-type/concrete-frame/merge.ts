import { mergeLegacyState } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';
import { coerceConcreteFrameDimension, toConcreteFramePatch } from './extract-llm.js';

export function mergeConcreteFrameState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const domainMerged = mergeLegacyState(
    existing,
    coerceConcreteFrameDimension(toConcreteFramePatch(patch), existing),
    'frame',
    'frame',
  );

  return {
    ...domainMerged,
    // M1: Separate concrete and rebar grade
    frameConcreteGrade: (patch.frameConcreteGrade as string | undefined) ?? (existing?.frameConcreteGrade as string | undefined),
    frameRebarGrade: (patch.frameRebarGrade as string | undefined) ?? (existing?.frameRebarGrade as string | undefined),
    frameColumnSection: (patch.frameColumnSection as string | undefined) ?? (existing?.frameColumnSection as string | undefined),
    frameBeamSection: (patch.frameBeamSection as string | undefined) ?? (existing?.frameBeamSection as string | undefined),
    siteSeismic: patch.siteSeismic !== undefined
      ? { ...(existing?.siteSeismic ?? {}), ...patch.siteSeismic }
      : existing?.siteSeismic,
    wind: patch.wind !== undefined
      ? { ...(existing?.wind ?? {}), ...patch.wind }
      : existing?.wind,
    analysisControl: patch.analysisControl !== undefined
      ? { ...(existing?.analysisControl ?? {}), ...patch.analysisControl }
      : existing?.analysisControl,
  };
}
