import { mergeLegacyState } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';
import { normalizeWallOpenings } from './constants.js';
import { parseSeismicGrade, SEISMIC_GRADE_LABELS } from './design.js';
import {
  isValidConcreteGrade,
  isValidRebarGrade,
  normalizeConcreteGrade,
  normalizeRebarGrade,
} from './model.js';

function mergeSeismicGrade(existing: unknown, patch: unknown): string | undefined {
  const patchGrade = parseSeismicGrade(patch);
  if (patchGrade !== undefined) return SEISMIC_GRADE_LABELS[patchGrade];
  const existingGrade = parseSeismicGrade(existing);
  if (existingGrade !== undefined) return SEISMIC_GRADE_LABELS[existingGrade];
  return undefined;
}

function mergeWallOpenings(existing: unknown, patch: unknown): ReturnType<typeof normalizeWallOpenings> {
  const normalizedPatch = normalizeWallOpenings(patch);
  if (normalizedPatch !== undefined) return normalizedPatch;
  return normalizeWallOpenings(existing);
}

export function mergeShearWallState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  const merged = mergeLegacyState(existing, patch, 'frame', 'shear-wall');

  const patchLength = typeof patch.wallLengthM === 'number' && patch.wallLengthM > 0 ? patch.wallLengthM : undefined;
  const existingLength = typeof existing?.wallLengthM === 'number' && existing.wallLengthM > 0 ? existing.wallLengthM : undefined;
  const patchThickness = typeof patch.wallThicknessMm === 'number' && patch.wallThicknessMm > 0 ? patch.wallThicknessMm : undefined;
  const existingThickness = typeof existing?.wallThicknessMm === 'number' && existing.wallThicknessMm > 0 ? existing.wallThicknessMm : undefined;
  const patchConcrete = typeof patch.wallConcreteGrade === 'string' && isValidConcreteGrade(patch.wallConcreteGrade)
    ? normalizeConcreteGrade(patch.wallConcreteGrade)
    : undefined;
  const existingConcrete = typeof existing?.wallConcreteGrade === 'string' && isValidConcreteGrade(existing.wallConcreteGrade)
    ? normalizeConcreteGrade(existing.wallConcreteGrade)
    : undefined;
  const patchRebar = typeof patch.wallRebarGrade === 'string' && isValidRebarGrade(patch.wallRebarGrade)
    ? normalizeRebarGrade(patch.wallRebarGrade)
    : undefined;
  const existingRebar = typeof existing?.wallRebarGrade === 'string' && isValidRebarGrade(existing.wallRebarGrade)
    ? normalizeRebarGrade(existing.wallRebarGrade)
    : undefined;

  return {
    ...merged,
    ...(patchLength !== undefined || existingLength !== undefined
      ? { wallLengthM: patchLength ?? existingLength }
      : {}),
    ...(patchThickness !== undefined || existingThickness !== undefined
      ? { wallThicknessMm: patchThickness ?? existingThickness }
      : {}),
    ...(patchConcrete !== undefined || existingConcrete !== undefined
      ? { wallConcreteGrade: patchConcrete ?? existingConcrete }
      : {}),
    ...(patchRebar !== undefined || existingRebar !== undefined
      ? { wallRebarGrade: patchRebar ?? existingRebar }
      : {}),
    ...(mergeSeismicGrade(existing?.seismicGrade, patch.seismicGrade) !== undefined
      ? { seismicGrade: mergeSeismicGrade(existing?.seismicGrade, patch.seismicGrade) }
      : {}),
    ...(mergeWallOpenings(existing?.wallOpenings, patch.wallOpenings) !== undefined
      ? { wallOpenings: mergeWallOpenings(existing?.wallOpenings, patch.wallOpenings) }
      : {}),
  };
}
