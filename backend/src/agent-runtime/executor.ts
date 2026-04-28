import type { ChatOpenAI } from '@langchain/openai';
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
      input.locale === 'zh'
        ? '重要：当 Known draft state 已有参数值时，draftPatch 中必须保留所有已提取的工程参数（如长度、荷载、材料等），并补充新提取的值。不要回显元数据字段（如 updatedAt、skillId、structuralTypeKey）。'
        : 'CRITICAL: When Known draft state contains values, you MUST preserve all previously extracted *parameter* fields in draftPatch along with any newly extracted values. Do not echo metadata fields (updatedAt, skillId, structuralTypeKey, etc.).',
      input.locale === 'zh'
        ? '只有同时考虑当前消息和 Known draft state 后仍然未知的字段，才能放入 missingCritical。'
        : 'Only add fields to missingCritical if they are genuinely unknown after considering BOTH the current message AND the Known draft state.',
      input.locale === 'zh'
        ? '梁状态累积示例：已知 state={"inferredType":"beam","lengthM":6}，用户说"20kN均布荷载"，正确输出={"inferredType":"beam","draftPatch":{"inferredType":"beam","lengthM":6,"supportType":"simply-supported","loadKN":20,"loadType":"distributed","loadPosition":"full-span"}}'
        : 'Beam state accumulation example: Known state={"inferredType":"beam","lengthM":6}, user says "20kN distributed load", correct output={"inferredType":"beam","draftPatch":{"inferredType":"beam","lengthM":6,"supportType":"simply-supported","loadKN":20,"loadType":"distributed","loadPosition":"full-span"}}',
      input.locale === 'zh'
        ? '门式刚架状态累积示例：已知 state={"inferredType":"portal-frame","spanLengthM":24,"heightM":8}，用户说"荷载10kN/m"，正确输出={"inferredType":"portal-frame","draftPatch":{"inferredType":"portal-frame","spanLengthM":24,"heightM":8,"loadKN":10,"loadType":"distributed"}}'
        : 'Portal-frame state accumulation example: Known state={"inferredType":"portal-frame","spanLengthM":24,"heightM":8}, user says "load 10kN/m", correct output={"inferredType":"portal-frame","draftPatch":{"inferredType":"portal-frame","spanLengthM":24,"heightM":8,"loadKN":10,"loadType":"distributed"}}',
      `Known draft state: ${JSON.stringify(input.existingState || {})}`,
      `User message: ${input.message}`,
      'Markdown skill:',
      buildSkillPrompt(input),
    ].join('\n\n');

    try {
      const aiMessage = await this.llm.invoke(prompt, { signal: input.signal });
      const content = typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content);
      const parsedJson = this.parseJsonObject(content);
      if (!parsedJson) {
        return { parsed: null, draftPatch: null };
      }

      const rawDraftPatch = (parsedJson.draftPatch && typeof parsedJson.draftPatch === 'object' && !Array.isArray(parsedJson.draftPatch))
        ? parsedJson.draftPatch as Record<string, unknown>
        : null;
      const rawInferredType = typeof parsedJson.inferredType === 'string'
        ? parsedJson.inferredType
        : undefined;

      try {
        const parsed = skillExecutionSchema.parse(parsedJson);
        return {
          parsed,
          draftPatch: parsed.draftPatch ?? rawDraftPatch,
        };
      } catch {
        return {
          parsed: rawInferredType
            ? { inferredType: rawInferredType, draftPatch: rawDraftPatch ?? undefined } as SkillExecutionPayload
            : null,
          draftPatch: rawDraftPatch,
        };
      }
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
