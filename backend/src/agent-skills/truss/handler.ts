import {
  buildLegacyDraftPatchLlmFirst,
  buildLegacyLabels,
  buildLegacyModel,
  buildLegacyQuestions,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../services/agent-skills/legacy.js';
import { buildScenarioMatch, resolveLegacyStructuralStage } from '../../services/agent-skills/plugin-helpers.js';
import type { DraftExtraction, SkillHandler } from '../../services/agent-skills/types.js';

const ALLOWED_KEYS = ['lengthM', 'loadKN', 'loadType', 'loadPosition'] as const;

function toTrussPatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch(patch, 'truss', [...ALLOWED_KEYS]);
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('truss') || text.includes('桁架')) {
      return buildScenarioMatch('truss', 'truss', 'truss', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toTrussPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toTrussPatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toTrussPatch(patch), 'truss', 'truss');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'truss' }, mode, ['lengthM', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildLegacyQuestions(keys, criticalMissing, { ...state, inferredType: 'truss' }, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'truss' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
