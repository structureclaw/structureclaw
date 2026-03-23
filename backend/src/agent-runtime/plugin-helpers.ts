import type { AppLocale } from '../services/locale.js';
import type { DraftState, ScenarioMatch, ScenarioSupportLevel } from './types.js';

type StructuralStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';

export function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

export function buildScenarioMatch(
  key: ScenarioMatch['key'],
  mappedType: ScenarioMatch['mappedType'],
  skillId: string,
  supportLevel: ScenarioSupportLevel,
  locale: AppLocale,
  note?: { zh: string; en: string },
): ScenarioMatch {
  return {
    key,
    mappedType,
    skillId,
    supportLevel,
    supportNote: note ? localize(locale, note.zh, note.en) : undefined,
  };
}

export function withScenarioState(state: DraftState, scenario: ScenarioMatch): DraftState {
  return {
    ...state,
    inferredType: scenario.mappedType,
    skillId: scenario.skillId,
    scenarioKey: scenario.key,
    supportLevel: scenario.supportLevel,
    supportNote: scenario.supportNote,
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
