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

const ALLOWED_KEYS = ['spanLengthM', 'heightM', 'loadKN', 'loadType', 'loadPosition'] as const;

function toPortalFramePatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch({
    ...patch,
    spanLengthM: patch.spanLengthM ?? patch.lengthM,
  }, 'portal-frame', [...ALLOWED_KEYS]);
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('portal frame') || text.includes('门式刚架')) {
      return buildScenarioMatch('portal-frame', 'portal-frame', 'portal-frame', 'supported', locale);
    }
    if (text.includes('portal') || text.includes('门架') || text.includes('刚架')) {
      return buildScenarioMatch('portal', 'portal-frame', 'portal-frame', 'fallback', locale, {
        zh: '已将“门架/刚架”先收敛到门式刚架模板继续补参。',
        en: '“Portal structure” has been narrowed to the portal-frame template for continued guidance.',
      });
    }
    return null;
  },
  parseProvidedValues(values) {
    return toPortalFramePatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toPortalFramePatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toPortalFramePatch(patch), 'portal-frame', 'portal-frame');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'portal-frame' }, mode, ['spanLengthM', 'heightM', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildLegacyQuestions(keys, criticalMissing, { ...state, inferredType: 'portal-frame' }, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'portal-frame' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
