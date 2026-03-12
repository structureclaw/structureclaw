import { ChatOpenAI } from '@langchain/openai';
import { skillExecutionSchema, type SkillExecutionPayload } from './schema.js';
import { normalizeInferredType, normalizeLoadPosition, normalizeLoadType, normalizeNumber } from './fallback.js';
import type { AgentSkillBundle, AgentSkillExecutorInput, DraftExtraction } from './types.js';

function buildSkillPrompt(skills: AgentSkillBundle[]): string {
  return skills.map((skill) => {
    const sections = [
      `# Skill: ${skill.id}`,
      `Name(zh): ${skill.name.zh}`,
      `Name(en): ${skill.name.en}`,
      `Description(zh): ${skill.description.zh}`,
      `Description(en): ${skill.description.en}`,
      `Triggers: ${skill.triggers.join(', ')}`,
      ...Object.entries(skill.markdownByStage).map(([stage, markdown]) => `## ${stage}\n${markdown}`),
    ];
    return sections.join('\n');
  }).join('\n\n');
}

function normalizeDraftPatch(patch: SkillExecutionPayload['draftPatch']): DraftExtraction | null {
  if (!patch) {
    return null;
  }
  return {
    inferredType: normalizeInferredType(patch.inferredType),
    lengthM: normalizeNumber(patch.lengthM),
    spanLengthM: normalizeNumber(patch.spanLengthM),
    heightM: normalizeNumber(patch.heightM),
    loadKN: normalizeNumber(patch.loadKN),
    loadType: normalizeLoadType(patch.loadType),
    loadPosition: normalizeLoadPosition(patch.loadPosition),
  };
}

export class AgentSkillExecutor {
  constructor(private readonly llm: ChatOpenAI | null) {}

  async execute(input: AgentSkillExecutorInput): Promise<{ parsed: SkillExecutionPayload | null; draftPatch: DraftExtraction | null }> {
    if (!this.llm || input.enabledSkills.length === 0) {
      return { parsed: null, draftPatch: null };
    }

    const prompt = [
      input.locale === 'zh'
        ? '你是结构工程 agent 的 skill 执行器。请严格依据给定 Markdown skills 理解用户意图，并输出 JSON。'
        : 'You are the structural engineering agent skill executor. Follow the supplied Markdown skills and return JSON only.',
      input.locale === 'zh'
        ? '不要输出 markdown，不要解释，只输出一个 JSON 对象。缺失字段可以省略。'
        : 'Do not return markdown or explanations. Return one JSON object only. Omit fields that are unavailable.',
      input.locale === 'zh'
        ? 'JSON 字段允许：detectedScenario, inferredType, draftPatch, missingCritical, missingOptional, questions, defaultProposals, stage, supportLevel, supportNote。'
        : 'Allowed JSON fields: detectedScenario, inferredType, draftPatch, missingCritical, missingOptional, questions, defaultProposals, stage, supportLevel, supportNote.',
      `Known draft state: ${JSON.stringify(input.existingState || {})}`,
      `User message: ${input.message}`,
      'Markdown skills:',
      buildSkillPrompt(input.enabledSkills),
    ].join('\n\n');

    try {
      const aiMessage = await this.llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content);
      const parsedJson = JSON.parse(content);
      const parsed = skillExecutionSchema.parse(parsedJson);
      return {
        parsed,
        draftPatch: normalizeDraftPatch(parsed.draftPatch),
      };
    } catch {
      return { parsed: null, draftPatch: null };
    }
  }
}
