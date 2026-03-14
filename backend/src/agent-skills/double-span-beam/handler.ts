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

const ALLOWED_KEYS = ['spanLengthM', 'loadKN', 'loadType', 'loadPosition'] as const;

function toDoubleSpanPatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch({
    ...patch,
    spanLengthM: patch.spanLengthM ?? patch.lengthM,
  }, 'double-span-beam', [...ALLOWED_KEYS]);
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('double-span') || text.includes('双跨梁')) {
      return buildScenarioMatch('double-span-beam', 'double-span-beam', 'double-span-beam', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toDoubleSpanPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toDoubleSpanPatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toDoubleSpanPatch(patch), 'double-span-beam', 'double-span-beam');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'double-span-beam' }, mode, ['spanLengthM', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildLegacyQuestions(keys, criticalMissing, { ...state, inferredType: 'double-span-beam' }, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'double-span-beam' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
