import type { SkillHandler } from '../../../agent-runtime/types.js';
import { detectShearWallStructuralType } from './detect.js';
import { buildShearWallPatchFromLlm, parseShearWallProvidedValues } from './extract-llm.js';
import {
  buildShearWallDefaultProposals,
  buildShearWallQuestions,
  buildShearWallReportNarrative,
  computeShearWallMissing,
  mapShearWallLabels,
  resolveShearWallStage,
} from './interaction.js';
import { mergeShearWallState } from './merge.js';
import { buildShearWallModel } from './model.js';

export const handler: SkillHandler = {
  detectStructuralType(input) {
    return detectShearWallStructuralType(input);
  },

  parseProvidedValues(values) {
    return parseShearWallProvidedValues(values);
  },

  extractDraft({ llmDraftPatch, currentState }) {
    return buildShearWallPatchFromLlm(llmDraftPatch, currentState);
  },

  mergeState(existing, patch) {
    return mergeShearWallState(existing, patch);
  },

  computeMissing(state, phase) {
    return computeShearWallMissing(state, phase);
  },

  mapLabels(keys, locale) {
    return mapShearWallLabels(keys, locale);
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    return buildShearWallQuestions(keys, criticalMissing, state, locale);
  },

  buildDefaultProposals(keys, state, locale) {
    return buildShearWallDefaultProposals(keys, state, locale);
  },

  buildReportNarrative(input) {
    return buildShearWallReportNarrative(input);
  },

  buildModel(state) {
    if (computeShearWallMissing(state, 'execution').critical.length > 0) {
      return undefined;
    }
    try {
      return buildShearWallModel(state);
    } catch (error) {
      console.error('buildShearWallModel failed:', error);
      return undefined;
    }
  },

  resolveStage(missingKeys) {
    return resolveShearWallStage(missingKeys);
  },
};

export default handler;
