/**
 * ai-structure design skill handler.
 *
 * Design-iteration flow (SkillHandler.buildDesign):
 *   1. Extract failing members (utilization > 1) from code-check results.
 *   2. When the external service is enabled in settings, request optimized
 *      section suggestions from ai-structure.com (retry/backoff/timeout).
 *   3. On any service failure — or when the service is disabled — fall back
 *      to the built-in rule-based local design engine.
 *   4. Wrap the proposal into a SkillDesignResult. When approval is required,
 *      the proposal is returned unapplied (blocked_approval) so the agent can
 *      ask the user before adjusting the model.
 */
import type {
  DesignSectionChange,
  DraftExtraction,
  DraftState,
  SkillDesignInput,
  SkillDesignResult,
  SkillDraftContext,
  SkillHandler,
} from '../../../agent-runtime/types.js';
import { resolveDesignSettings } from '../../../config/design-settings.js';
import { buildSkillDesignResultFromProvider, DESIGN_LOOP_PROVIDER_LOCAL } from '../loop.js';
import {
  applySectionShape,
  displayNameForShape,
  extractMemberFailures,
  parseSectionShape,
  proposeLocalRuleDesign,
  sectionShapeChanged,
  type DesignProviderResult,
} from '../provider.js';
import {
  AiStructureClientError,
  requestAiStructureDesign,
  toAiStructureFailingMembers,
} from './client.js';

export const AI_STRUCTURE_SKILL_ID = 'design-ai-structure';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sectionIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Build a localized fallback note when the external service is skipped. */
function fallbackNote(reason: string, locale: 'zh' | 'en'): string {
  return locale === 'zh'
    ? `智能设计服务不可用（${reason}），已回退到本地规则设计引擎。`
    : `The ai-structure service was unavailable (${reason}); fell back to the local rule-based design engine.`;
}

/**
 * Request section suggestions from the ai-structure service and apply them to
 * the model. Throws when the service is unreachable or responds off-schema.
 */
export async function proposeAiStructureDesign(
  input: SkillDesignInput,
): Promise<DesignProviderResult> {
  const settings = input.settings ?? resolveDesignSettings();
  const aiSettings = settings.aiStructure;
  if (!aiSettings.enabled) {
    throw new AiStructureClientError('ai-structure integration is disabled', 'NOT_CONFIGURED');
  }
  if (!aiSettings.apiKey) {
    throw new AiStructureClientError('ai-structure API key is not configured', 'NOT_CONFIGURED');
  }

  const failures = extractMemberFailures(input.codeCheck);
  const sectionIdByElement = new Map<string, string>();
  for (const element of Array.isArray(input.model.elements) ? input.model.elements as unknown[] : []) {
    const record = asRecord(element);
    const elementId = sectionIdOf(record.id);
    const sectionId = sectionIdOf(record.section);
    if (elementId && sectionId) sectionIdByElement.set(elementId, sectionId);
  }
  const failingMembers = toAiStructureFailingMembers(failures, sectionIdByElement);
  if (failingMembers.length === 0) {
    return {
      provider: 'ai-structure',
      changes: [],
      model: input.model,
      maxUtilizationBefore: failures[0]?.utilization,
      notes: ['No failing member with a section reference was found for the external design service.'],
    };
  }

  const response = await requestAiStructureDesign(aiSettings, {
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    model: input.model,
    failingMembers,
  });

  const sections = Array.isArray(input.model.sections) ? input.model.sections as unknown[] : [];
  const suggestionBySection = new Map(response.suggestions.map((suggestion) => [suggestion.sectionId, suggestion]));
  // Group failing members per section once: element ids + controlling utilization.
  const elementsBySection = new Map<string, string[]>();
  const utilizationBySection = new Map<string, number>();
  for (const member of failingMembers) {
    elementsBySection.set(member.sectionId, [...(elementsBySection.get(member.sectionId) ?? []), member.elementId]);
    const current = utilizationBySection.get(member.sectionId);
    if (current === undefined || member.utilization > current) {
      utilizationBySection.set(member.sectionId, member.utilization);
    }
  }

  const changes: DesignSectionChange[] = [];
  let maxUtilizationBefore = 0;

  const nextSections = sections.map((section) => {
    const record = asRecord(section);
    const sectionId = sectionIdOf(record.id);
    const suggestion = sectionId ? suggestionBySection.get(sectionId) : undefined;
    if (!sectionId || !suggestion) return section;
    const currentShape = parseSectionShape(record);
    if (currentShape && !sectionShapeChanged(currentShape, suggestion.shape)) {
      return section;
    }
    const previousName = typeof record.name === 'string' ? record.name : sectionId;
    const name = suggestion.sectionName ?? displayNameForShape(suggestion.shape, previousName);
    const utilizationBefore = utilizationBySection.get(sectionId);
    if (utilizationBefore !== undefined) maxUtilizationBefore = Math.max(maxUtilizationBefore, utilizationBefore);
    changes.push({
      sectionId,
      elementIds: elementsBySection.get(sectionId) ?? [],
      purpose: typeof record.purpose === 'string' ? record.purpose : undefined,
      before: previousName,
      after: name,
      ...(utilizationBefore !== undefined ? { utilizationBefore: Number(utilizationBefore.toFixed(4)) } : {}),
      reason: 'Section optimized by the ai-structure design service.',
    });
    return applySectionShape(record, suggestion.shape, name);
  });

  if (changes.length === 0) {
    return {
      provider: 'ai-structure',
      changes: [],
      model: input.model,
      maxUtilizationBefore: maxUtilizationBefore || undefined,
      notes: ['The ai-structure service returned no applicable section suggestions.'],
    };
  }

  const metadata = asRecord(input.model.metadata);
  const nextMetadata: Record<string, unknown> = { ...metadata };
  for (const change of changes) {
    if (change.purpose === 'column') nextMetadata.columnSection = change.after;
    if (change.purpose === 'beam') nextMetadata.beamSection = change.after;
  }

  return {
    provider: 'ai-structure',
    changes,
    model: {
      ...input.model,
      sections: nextSections,
      metadata: nextMetadata,
    },
    ...(maxUtilizationBefore > 0 ? { maxUtilizationBefore } : {}),
    notes: [],
  };
}

/** buildDesign implementation for the ai-structure skill. */
export async function buildDesign(input: SkillDesignInput): Promise<SkillDesignResult> {
  const settings = input.settings ?? resolveDesignSettings();
  const approved = input.approved !== false;
  const locale = input.locale === 'en' ? 'en' : 'zh';
  const notes: string[] = [];
  let providerResult: DesignProviderResult;
  let costEstimate: SkillDesignResult['costEstimate'];
  let costCurrency: string | undefined;

  if (settings.aiStructure.enabled && settings.aiStructure.apiKey) {
    try {
      providerResult = await proposeAiStructureDesign(input);
      if (providerResult.provider === 'ai-structure' && providerResult.changes.length > 0) {
        const estimated = settings.aiStructure.estimatedCostPerCall;
        if (estimated !== undefined) {
          costEstimate = { amount: estimated };
          costCurrency = 'CNY';
        }
      }
    } catch (error) {
      const reason = error instanceof AiStructureClientError
        ? `${error.code}${error.status ? `/${error.status}` : ''}`
        : (error instanceof Error ? error.message : 'unknown error');
      notes.push(fallbackNote(reason, locale));
      providerResult = await proposeLocalRuleDesign({
        model: input.model,
        codeCheck: input.codeCheck ?? null,
        analysis: input.analysis ?? null,
      });
    }
  } else {
    const reason = settings.aiStructure.enabled ? 'API key missing' : 'disabled in settings';
    notes.push(fallbackNote(reason, locale));
    providerResult = await proposeLocalRuleDesign({
      model: input.model,
      codeCheck: input.codeCheck ?? null,
      analysis: input.analysis ?? null,
    });
  }

  const result = buildSkillDesignResultFromProvider({
    providerResult,
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    approved,
    designSkillId: providerResult.provider === DESIGN_LOOP_PROVIDER_LOCAL ? AI_STRUCTURE_SKILL_ID : providerResult.provider,
    ...(costEstimate !== undefined ? { costEstimate: { ...costEstimate, ...(costCurrency ? { currency: costCurrency } : {}) } } : {}),
    ...(notes.length > 0 ? { providerMeta: { notes } } : {}),
  });
  return result;
}

// ---------------------------------------------------------------------------
// Inert SkillHandler surface (design-domain skill — never participates in
// structure-type routing; required interface methods are no-ops).
// ---------------------------------------------------------------------------

export const handler: SkillHandler = {
  detectStructuralType: () => null,
  parseProvidedValues: (values: Record<string, unknown>): DraftExtraction => ({ ...values }),
  extractDraft: (input: SkillDraftContext): DraftExtraction => ({
    structuralTypeKey: input.structuralTypeMatch.key,
    skillId: AI_STRUCTURE_SKILL_ID,
  }),
  mergeState: (existing: DraftState | undefined, patch: DraftExtraction): DraftState => ({
    ...(existing ?? { inferredType: 'unknown' }),
    ...patch,
    updatedAt: Date.now(),
  }),
  computeMissing: () => ({ critical: [], optional: [] }),
  mapLabels: (keys: string[]): string[] => keys,
  buildQuestions: () => [],
  buildModel: () => undefined,
  buildDesign,
};

export default handler;
