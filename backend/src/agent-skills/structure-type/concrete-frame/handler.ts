import { normalizeLegacyDraftPatch } from '../../../agent-runtime/legacy.js';
import type { SkillHandler } from '../../../agent-runtime/types.js';
import { detectConcreteFrameStructuralType } from './detect.js';
import { buildConcreteFrameDraftPatch, coerceConcreteFrameDimension, toConcreteFramePatch } from './extract-llm.js';
import {
  buildConcreteFrameDefaultProposals,
  buildConcreteFrameQuestions,
  buildConcreteFrameReportNarrative,
  computeConcreteFrameMissing,
  mapConcreteFrameLabels,
  resolveConcreteFrameStage,
} from './interaction.js';
import { mergeConcreteFrameState } from './merge.js';
import { buildConcreteFrameModel, normalizeConcreteGrade, normalizeSectionName } from './model.js';

export const handler: SkillHandler = {
  detectStructuralType(input) {
    return detectConcreteFrameStructuralType(input);
  },

  parseProvidedValues(values) {
    const base = coerceConcreteFrameDimension(
      toConcreteFramePatch(normalizeLegacyDraftPatch(values)),
      undefined,
      JSON.stringify(values),
    );
    return {
      ...base,
      ...(typeof values.frameMaterial === 'string' && { frameMaterial: normalizeConcreteGrade(values.frameMaterial) }),
      ...(typeof values.frameColumnSection === 'string' && { frameColumnSection: normalizeSectionName(values.frameColumnSection) }),
      ...(typeof values.frameBeamSection === 'string' && { frameBeamSection: normalizeSectionName(values.frameBeamSection) }),
    };
  },

  extractDraft({ message, llmDraftPatch, currentState }) {
    return buildConcreteFrameDraftPatch(message, llmDraftPatch, currentState);
  },

  mergeState(existing, patch) {
    return mergeConcreteFrameState(existing, patch);
  },

  computeMissing(state, phase) {
    return computeConcreteFrameMissing(state, phase);
  },

  mapLabels(keys, locale) {
    return mapConcreteFrameLabels(keys, locale);
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    return buildConcreteFrameQuestions(keys, criticalMissing, state, locale);
  },

  buildDefaultProposals(keys, state, locale) {
    return buildConcreteFrameDefaultProposals(keys, state, locale);
  },

  buildReportNarrative(input) {
    return buildConcreteFrameReportNarrative(input);
  },

  buildModel(state) {
    return buildConcreteFrameModel(state);
  },

  resolveStage(missingKeys) {
    return resolveConcreteFrameStage(missingKeys);
  },
};

export default handler;