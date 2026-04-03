import type { AppLocale } from '../services/locale.js';
import type { DraftState, StructuralTypeMatch, StructuralTypeSupportLevel } from './types.js';

type StructuralStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';

export function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

export function buildStructuralTypeMatch(
  key: StructuralTypeMatch['key'],
  mappedType: StructuralTypeMatch['mappedType'],
  skillId: string,
  supportLevel: StructuralTypeSupportLevel,
  locale: AppLocale,
  note?: { zh: string; en: string },
): StructuralTypeMatch {
  return {
    key,
    mappedType,
    skillId,
    supportLevel,
    supportNote: note ? localize(locale, note.zh, note.en) : undefined,
  };
}

export function withStructuralTypeState(state: DraftState, structuralTypeMatch: StructuralTypeMatch): DraftState {
  const preserveInferredType = structuralTypeMatch.mappedType === 'unknown' && state.inferredType && state.inferredType !== 'unknown';
  const inferredType = preserveInferredType ? state.inferredType : structuralTypeMatch.mappedType;
  const structuralTypeKey = preserveInferredType
    ? (state.structuralTypeKey ?? state.inferredType)
    : structuralTypeMatch.key;
  return {
    ...state,
    inferredType,
    skillId: structuralTypeMatch.skillId,
    structuralTypeKey,
    supportLevel: structuralTypeMatch.supportLevel,
    supportNote: structuralTypeMatch.supportNote,
    updatedAt: Date.now(),
  };
}

export function resolveLegacyStructuralStage(missingKeys: string[]): StructuralStage {
  if (missingKeys.includes('inferredType')) {
    return 'intent';
  }
  if (missingKeys.some((key) => [
    'lengthM',
    'spanLengthM',
    'heightM',
    'supportType',
    'frameDimension',
    'storyCount',
    'bayCount',
    'bayCountX',
    'bayCountY',
    'storyHeightsM',
    'bayWidthsM',
    'bayWidthsXM',
    'bayWidthsYM',
  ].includes(key))) {
    return 'model';
  }
  return 'loads';
}
