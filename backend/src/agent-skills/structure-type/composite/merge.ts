import { mergeLegacyState } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';
import { toPositiveNumberFromUnknown } from './constants.js';
import {
  isValidConcreteGrade,
  isValidSteelGrade,
  normalizeConcreteGrade,
  normalizeSectionName,
  normalizeSteelGrade,
} from './design.js';

function mergePositiveNumber(existing: unknown, patch: unknown): number | undefined {
  const patchValue = toPositiveNumberFromUnknown(patch);
  if (patchValue !== undefined) return patchValue;
  return toPositiveNumberFromUnknown(existing);
}

function mergeSectionName(existing: unknown, patch: unknown): string | undefined {
  if (typeof patch === 'string' && patch.trim()) return normalizeSectionName(patch);
  if (typeof existing === 'string' && existing.trim()) return normalizeSectionName(existing);
  return undefined;
}

function mergeGrade(existing: unknown, patch: unknown, isValid: (raw: string) => boolean, normalize: (raw: string) => string): string | undefined {
  if (typeof patch === 'string' && isValid(patch)) return normalize(patch);
  if (typeof existing === 'string' && isValid(existing)) return normalize(existing);
  return undefined;
}

export function mergeCompositeState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
  // The composite model is always a 2D frame elevation; forcing the dimension
  // keeps mergeDraftState from dropping the bay widths (a stray '3d' patch
  // value would move them to bayWidthsXM/YM instead).
  const merged = mergeLegacyState(existing, { ...patch, frameDimension: '2d' }, 'frame', 'composite');

  const slabThickness = mergePositiveNumber(existing?.compositeSlabThicknessMm, patch.compositeSlabThicknessMm);
  const slabWidth = mergePositiveNumber(existing?.compositeSlabWidthM, patch.compositeSlabWidthM);
  const studDiameter = mergePositiveNumber(existing?.compositeStudDiameterMm, patch.compositeStudDiameterMm);
  const beamSection = mergeSectionName(existing?.compositeSteelBeamSection, patch.compositeSteelBeamSection);
  const columnSection = mergeSectionName(existing?.compositeSteelColumnSection, patch.compositeSteelColumnSection);
  const steelGrade = mergeGrade(
    existing?.compositeSteelGrade,
    patch.compositeSteelGrade,
    isValidSteelGrade,
    normalizeSteelGrade,
  );
  const concreteGrade = mergeGrade(
    existing?.compositeConcreteGrade,
    patch.compositeConcreteGrade,
    isValidConcreteGrade,
    normalizeConcreteGrade,
  );

  return {
    ...merged,
    ...(slabThickness !== undefined && { compositeSlabThicknessMm: slabThickness }),
    ...(slabWidth !== undefined && { compositeSlabWidthM: slabWidth }),
    ...(studDiameter !== undefined && { compositeStudDiameterMm: studDiameter }),
    ...(beamSection !== undefined && { compositeSteelBeamSection: beamSection }),
    ...(columnSection !== undefined && { compositeSteelColumnSection: columnSection }),
    ...(steelGrade !== undefined && { compositeSteelGrade: steelGrade }),
    ...(concreteGrade !== undefined && { compositeConcreteGrade: concreteGrade }),
  };
}
