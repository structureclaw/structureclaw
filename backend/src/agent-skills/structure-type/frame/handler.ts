import { normalizeLegacyDraftPatch } from '../../../agent-runtime/legacy.js';
import type { SkillHandler } from '../../../agent-runtime/types.js';
import { detectFrameStructuralType } from './detect.js';
import { buildFrameDraftPatch, coerceFrameDimension, toFramePatch } from './extract-llm.js';
import {
  buildFrameDefaultProposals,
  buildFrameQuestions,
  buildFrameReportNarrative,
  computeFrameMissing,
  mapFrameLabels,
  resolveFrameStage,
} from './interaction.js';
import { mergeFrameState } from './merge.js';
import { buildFrameModel, normalizeSectionName, normalizeSteelGrade } from './model.js';

export const handler: SkillHandler = {
  detectStructuralType(input) {
    return detectFrameStructuralType(input);
  },

  parseProvidedValues(values) {
    const base = coerceFrameDimension(
      toFramePatch(normalizeLegacyDraftPatch(values)),
      undefined,
      JSON.stringify(values),
    );
    return {
      ...base,
      ...(typeof values.frameMaterial === 'string' && { frameMaterial: normalizeSteelGrade(values.frameMaterial) }),
      ...(typeof values.frameColumnSection === 'string' && { frameColumnSection: normalizeSectionName(values.frameColumnSection) }),
      ...(typeof values.frameBeamSection === 'string' && { frameBeamSection: normalizeSectionName(values.frameBeamSection) }),
    };
  },

  extractDraft({ message, llmDraftPatch, currentState }) {
    return buildFrameDraftPatch(message, llmDraftPatch, currentState);
  },

  mergeState(existing, patch) {
    return mergeFrameState(existing, patch);
  },

  computeMissing(state, phase) {
    return computeFrameMissing(state, phase);
  },

  mapLabels(keys, locale) {
    return mapFrameLabels(keys, locale);
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    return buildFrameQuestions(keys, criticalMissing, state, locale);
  },

  buildDefaultProposals(keys, state, locale) {
    return buildFrameDefaultProposals(keys, state, locale);
  },

  buildReportNarrative(input) {
    return buildFrameReportNarrative(input);
  },

  buildModel(state) {
    return buildFrameModel(state);
  },

  resolveStage(missingKeys) {
    return resolveFrameStage(missingKeys);
  },
};

export default handler;
