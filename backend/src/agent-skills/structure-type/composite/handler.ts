import type { SkillHandler } from '../../../agent-runtime/types.js';
import { detectCompositeStructuralType } from './detect.js';
import { buildCompositePatchFromLlm, parseCompositeProvidedValues } from './extract-llm.js';
import {
  buildCompositeDefaultProposals,
  buildCompositeQuestions,
  buildCompositeReportNarrative,
  computeCompositeMissing,
  mapCompositeLabels,
  resolveCompositeStage,
} from './interaction.js';
import { mergeCompositeState } from './merge.js';
import { buildCompositeModel } from './model.js';

export const handler: SkillHandler = {
  detectStructuralType(input) {
    return detectCompositeStructuralType(input);
  },

  parseProvidedValues(values) {
    return parseCompositeProvidedValues(values);
  },

  extractDraft({ llmDraftPatch, currentState }) {
    return buildCompositePatchFromLlm(llmDraftPatch, currentState);
  },

  mergeState(existing, patch) {
    return mergeCompositeState(existing, patch);
  },

  computeMissing(state, phase) {
    return computeCompositeMissing(state, phase);
  },

  mapLabels(keys, locale) {
    return mapCompositeLabels(keys, locale);
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    return buildCompositeQuestions(keys, criticalMissing, state, locale);
  },

  buildDefaultProposals(keys, state, locale) {
    return buildCompositeDefaultProposals(keys, state, locale);
  },

  buildReportNarrative(input) {
    return buildCompositeReportNarrative(input);
  },

  buildModel(state) {
    if (computeCompositeMissing(state, 'execution').critical.length > 0) {
      return undefined;
    }
    try {
      return buildCompositeModel(state);
    } catch (error) {
      console.error('buildCompositeModel failed:', error);
      return undefined;
    }
  },

  resolveStage(missingKeys) {
    return resolveCompositeStage(missingKeys);
  },
};

export default handler;
