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

const ALLOWED_KEYS = ['lengthM', 'supportType', 'loadKN', 'loadType', 'loadPosition'] as const;

function toBeamPatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch(patch, 'beam', [...ALLOWED_KEYS]);
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
    const text = message.toLowerCase();
    if (text.includes('portal frame') || text.includes('门式刚架') || text.includes('桁架') || text.includes('truss') || text.includes('双跨梁') || text.includes('double-span')) {
      return null;
    }
    if (text.includes('girder') || text.includes('主梁') || text.includes('大梁')) {
      return buildScenarioMatch('girder', 'beam', 'beam', 'fallback', locale, {
        zh: '已将“主梁/大梁”先按梁模板处理；若实际是连续梁或更复杂体系，请继续说明。',
        en: '“Girder” has been normalized to the beam template for now. If the actual system is continuous or more complex, please clarify further.',
      });
    }
    if (text.includes('beam') || text.includes('梁') || text.includes('悬臂')) {
      return buildScenarioMatch('beam', 'beam', 'beam', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return toBeamPatch(normalizeLegacyDraftPatch(values));
  },
  extractDraft({ message, llmDraftPatch }) {
    return toBeamPatch(buildLegacyDraftPatchLlmFirst(message, llmDraftPatch));
  },
  mergeState(existing, patch) {
    return mergeLegacyState(existing, toBeamPatch(patch), 'beam', 'beam');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing({ ...state, inferredType: 'beam' }, mode, ['lengthM', 'supportType', 'loadKN', 'loadType', 'loadPosition']);
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildLegacyQuestions(keys, criticalMissing, { ...state, inferredType: 'beam' }, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'beam' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
