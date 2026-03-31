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
        ? 'JSON 字段允许：inferredType, draftPatch, missingCritical, missingOptional, questions, defaultProposals, stage, supportLevel, supportNote。'
        : 'Allowed JSON fields: inferredType, draftPatch, missingCritical, missingOptional, questions, defaultProposals, stage, supportLevel, supportNote.',
      input.locale === 'zh'
        ? 'draftPatch 允许字段：inferredType,lengthM,spanLengthM,heightM,supportType,frameDimension,storyCount,bayCount,bayCountX,bayCountY,storyHeightsM,bayWidthsM,bayWidthsXM,bayWidthsYM,floorLoads,frameBaseSupportType,loadKN,loadType,loadPosition,loadPositionM,frameMaterial,frameColumnSection,frameBeamSection。'
        : 'draftPatch allowed fields: inferredType,lengthM,spanLengthM,heightM,supportType,frameDimension,storyCount,bayCount,bayCountX,bayCountY,storyHeightsM,bayWidthsM,bayWidthsXM,bayWidthsYM,floorLoads,frameBaseSupportType,loadKN,loadType,loadPosition,loadPositionM,frameMaterial,frameColumnSection,frameBeamSection.',
      input.locale === 'zh'
        ? 'loadPositionM 表示距左端位置（m）；若用户明确“4m处”这类位置，优先输出数值。'
        : 'loadPositionM means offset from left end in meters; if user specifies locations like 4m, provide numeric value.',
      input.locale === 'zh'
        ? '示例：{"inferredType":"beam","draftPatch":{"inferredType":"beam","lengthM":10,"supportType":"simply-supported","loadKN":10,"loadType":"point","loadPosition":"free-joint","loadPositionM":4}}'
        : 'Example: {"inferredType":"beam","draftPatch":{"inferredType":"beam","lengthM":10,"supportType":"simply-supported","loadKN":10,"loadType":"point","loadPosition":"free-joint","loadPositionM":4}}',
      `Known draft state: ${JSON.stringify(input.existingState || {})}`,
      `User message: ${input.message}`,
      'Markdown skill:',
      buildSkillPrompt(input),
    ].join('\n\n');

    try {
      const aiMessage = await this.llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content);
      const parsedJson = this.parseJsonObject(content);
      if (!parsedJson) {
        return { parsed: null, draftPatch: null };
      }
      const parsed = skillExecutionSchema.parse(parsedJson);
      return {
        parsed,
        draftPatch: parsed.draftPatch ?? null,
      };
    } catch {
      return { parsed: null, draftPatch: null };
    }
  }

  private parseJsonObject(content: string): Record<string, unknown> | null {
    const trimmed = content.trim();
    const direct = this.tryParseJson(trimmed);
    if (direct) {
      return direct;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      const parsedFence = this.tryParseJson(fenced[1]);
      if (parsedFence) {
        return parsedFence;
      }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return this.tryParseJson(trimmed.slice(firstBrace, lastBrace + 1));
    }

    return null;
  }

  private tryParseJson(content: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}
