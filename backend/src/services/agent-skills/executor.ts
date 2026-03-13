import { ChatOpenAI } from '@langchain/openai';
import { skillExecutionSchema, type SkillExecutionPayload } from './schema.js';
import type { AgentSkillExecutorInput } from './types.js';

function buildSkillPrompt(input: AgentSkillExecutorInput): string {
  const skill = input.selectedSkill;
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
}

export class AgentSkillExecutor {
  constructor(private readonly llm: ChatOpenAI | null) {}

  async execute(input: AgentSkillExecutorInput): Promise<{ parsed: SkillExecutionPayload | null; draftPatch: Record<string, unknown> | null }> {
    if (!this.llm) {
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
      'Markdown skill:',
      buildSkillPrompt(input),
    ].join('\n\n');

    try {
      const aiMessage = await this.llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content);
      const parsedJson = JSON.parse(content);
      const parsed = skillExecutionSchema.parse(parsedJson);
      return {
        parsed,
        draftPatch: parsed.draftPatch ?? null,
      };
    } catch {
      return { parsed: null, draftPatch: null };
    }
  }
}
