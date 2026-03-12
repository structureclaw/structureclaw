import { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from '../locale.js';
import { buildDraftResult, buildInteractionQuestions, computeMissingCriticalKeys, computeMissingLoadDetailKeys, mapMissingFieldLabels } from './fallback.js';
import { AgentSkillRegistry } from './registry.js';
import { AgentSkillExecutor } from './executor.js';
import type { DraftResult, DraftState, InferredModelType, InteractionQuestion, ScenarioMatch } from './types.js';

export type {
  AgentSkillBundle,
  DraftExtraction,
  DraftLoadPosition,
  DraftLoadType,
  DraftResult,
  DraftState,
  DraftSupportType,
  InferredModelType,
  InteractionQuestion,
  ScenarioMatch,
  ScenarioTemplateKey,
  ScenarioSupportLevel,
} from './types.js';

export class AgentSkillRuntime {
  private readonly registry: AgentSkillRegistry;

  constructor() {
    this.registry = new AgentSkillRegistry();
  }

  listSkills() {
    return this.registry.listSkills();
  }

  detectScenario(message: string, locale: AppLocale, currentType?: InferredModelType, skillIds?: string[]): ScenarioMatch {
    return this.registry.detectScenario(message, locale, currentType, skillIds);
  }

  getScenarioLabel(key: string, locale: AppLocale, skillIds?: string[]): string {
    return this.registry.getScenarioLabel(key, locale, skillIds);
  }

  async textToModelDraft(
    llm: ChatOpenAI | null,
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[]
  ): Promise<DraftResult> {
    const enabledSkills = this.registry.resolveEnabledSkills(skillIds);
    const executor = new AgentSkillExecutor(llm);
    const execution = await executor.execute({
      message,
      locale,
      existingState,
      enabledSkills,
    });
    return buildDraftResult(message, existingState, execution.draftPatch);
  }

  computeMissingCriticalKeys(state: DraftState): string[] {
    return computeMissingCriticalKeys(state);
  }

  computeMissingLoadDetailKeys(state: DraftState): string[] {
    return computeMissingLoadDetailKeys(state);
  }

  mapMissingFieldLabels(missing: string[], locale: AppLocale): string[] {
    return mapMissingFieldLabels(missing, locale);
  }

  buildInteractionQuestions(
    missingKeys: string[],
    criticalMissing: string[],
    draft: DraftState,
    locale: AppLocale,
  ): InteractionQuestion[] {
    return buildInteractionQuestions(missingKeys, criticalMissing, draft, locale);
  }
}
