import type { StructureClawChatModel } from '../utils/llm.js';
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
  constructor(private readonly llm: StructureClawChatModel | null) {}

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
        ? 'JSON 字段允许：inferredType, engineeringDraft, draftPatch, draftIssues, skillState, missingCritical, missingOptional, questions, defaultProposals, stage, supportLevel, supportNote。'
        : 'Allowed JSON fields: inferredType, engineeringDraft, draftPatch, draftIssues, skillState, missingCritical, missingOptional, questions, defaultProposals, stage, supportLevel, supportNote.',
      input.locale === 'zh'
        ? '当用户提出中国抗震、反应谱、时程、Pushover、弹塑性时程、设防烈度、设计地震分组、场地类别或地震波选择等抗震设计意图时，必须基于整句语义输出 skillState.seismicWorkflow；方法选择只允许来自语义理解后的结构化字段，不要用关键词或正则匹配决定 response_spectrum/time_history/pushover/elastic_plastic_time_history。'
        : 'When the user asks for China seismic design, response spectrum, time history, pushover, elastic-plastic time history, seismic intensity, design group, site class, or ground-motion selection, output skillState.seismicWorkflow from whole-message semantic understanding; method selection may only come from structured semantic fields, never keyword or regex matching for response_spectrum/time_history/pushover/elastic_plastic_time_history.',
      input.locale === 'zh'
        ? '如果用户提供 GB18306 区划表、地震波文件或本地地震波库，只把已提供的数据映射到 seismicWorkflow.designBasis.groundMotionZonation 或 seismicWorkflow.groundMotionSet；不要根据城市名或自然语言自行编造烈度、分组、特征周期或地震波记录。'
        : 'If the user provides a GB18306 zonation table, ground-motion files, or a local ground-motion catalog, map only the provided data into seismicWorkflow.designBasis.groundMotionZonation or seismicWorkflow.groundMotionSet; do not invent intensity, design group, characteristic period, or ground-motion records from city names or prose.',
      input.locale === 'zh'
        ? '如果用户、模型或上传表格提供构件抗震承载力、gammaRE、强剪弱弯、剪压比、节点核芯区、抗震墙边缘构件、钢构件长细比或宽厚比等校核证据，必须保留为结构化字段（如 seismicCapacity、capacityDesign、strongShearWeakBending、shearCompression、jointCore、wallData、boundaryElement、steelSeismicDetailing）；不要把这些证据只写成自然语言备注。'
        : 'If the user, model, or uploaded table provides member seismic capacity, gammaRE, capacity-design, strong-shear weak-bending, shear-compression, joint-core, seismic-wall boundary-element, steel slenderness, or steel width-thickness evidence, preserve it as structured fields such as seismicCapacity, capacityDesign, strongShearWeakBending, shearCompression, jointCore, wallData, boundaryElement, or steelSeismicDetailing; do not leave this evidence only as prose notes.',
      input.locale === 'zh'
        ? '优先输出 engineeringDraft：geometry 表达跨度/高度/多跨数组，loads 表达集中力、线荷载、面积荷载或节点荷载，wind.basicPressureKNM2 表达基本风压，analysis.engineTarget 表达 opensees/pkpm/yjk。必要时可同时输出旧 draftPatch。'
        : 'Prefer engineeringDraft as a top-level field: use geometry for lengths/heights/span arrays, loads for point/line/area/nodal loads, wind.basicPressureKNM2 for basic wind pressure, and analysis.engineTarget for opensees/pkpm/yjk. You may also output legacy draftPatch when useful.',
      input.locale === 'zh'
        ? '如果用户明确给出多个荷载，每个荷载都必须作为 engineeringDraft.loads 的独立条目输出，不要合并或丢弃集中力/节点力。'
        : 'If the user explicitly gives multiple loads, output each load as its own engineeringDraft.loads entry; do not merge or drop point/nodal loads.',
      input.locale === 'zh'
        ? '框架局部点荷载/节点荷载必须结构化输出 location.story 和 location.nodeRole；用户未指定唯一节点时，应输出结构化 draftIssue，不得自行选择节点。'
        : 'Localized frame point/nodal loads must include structured location.story and location.nodeRole; if the user does not identify a unique joint, emit a structured draftIssue instead of choosing one.',
      input.locale === 'zh'
        ? '如果用户给出数学上无效的几何尺寸、荷载符号/单位/位置含义不明确，或要求彼此矛盾，不要把相关值写入 engineeringDraft/draftPatch；输出 draftIssues，并把对应字段名写入 skillState.invalidDraftFields。数值仅仅非常规或很大/很小并不自动构成无效输入。'
        : 'If geometry is mathematically invalid, a load sign/unit/location is ambiguous, or requirements contradict one another, do not write the affected value into engineeringDraft/draftPatch; output draftIssues and put the corresponding field name in skillState.invalidDraftFields. An unusual, large, or small value is not invalid by magnitude alone.',
      input.locale === 'zh'
        ? '不得补写用户未提供的荷载单位或荷载种类；若荷载数值没有单位，或“楼面荷载”等表述无法区分总力、线荷载或面荷载，必须省略该荷载，输出 draftIssues 和 skillState.invalidDraftFields，并要求确认单位和荷载种类。'
        : 'Never supply a load unit or load kind that the user did not provide; if a load magnitude has no unit, or wording such as "floor load" does not distinguish total force, line load, or area load, omit that load, output draftIssues and skillState.invalidDraftFields, and ask the user to confirm the unit and load kind.',
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
        ? '当用户修改、替换或把已有荷载“增加到/减小到”一个新值时，旧荷载值已被新值取代：只输出更新后的物理荷载，并保持原作用位置、方向和荷载工况，不要同时保留新旧两个荷载。单次输入中，同一物理荷载也只能在 engineeringDraft.loads 中表达一次；已折算为线荷载时不要再输出源面荷载或重复 legacy floorLoads。'
        : 'When the user changes, replaces, or sets an existing load to a new increased/decreased value, the new value supersedes the old one: output only the updated physical load while preserving its location, direction, and load case; never retain both old and new loads. In one input, represent each physical load exactly once in engineeringDraft.loads; when an area load has already been converted to an applied line load, do not also output the source area load or duplicate legacy floorLoads.',
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

      const rawEngineeringDraft = parsedJson.engineeringDraft && typeof parsedJson.engineeringDraft === 'object' && !Array.isArray(parsedJson.engineeringDraft)
        ? { engineeringDraft: parsedJson.engineeringDraft }
        : this.looksLikeTopLevelEngineeringDraft(parsedJson)
          ? { engineeringDraft: parsedJson }
          : {};
      const rawIssuePatch = {
        ...(Array.isArray(parsedJson.draftIssues) ? { draftIssues: parsedJson.draftIssues } : {}),
        ...(parsedJson.skillState && typeof parsedJson.skillState === 'object' && !Array.isArray(parsedJson.skillState)
          ? { skillState: parsedJson.skillState }
          : {}),
      };
      const rawDraftPatch = (parsedJson.draftPatch && typeof parsedJson.draftPatch === 'object' && !Array.isArray(parsedJson.draftPatch))
        ? {
          ...(parsedJson.draftPatch as Record<string, unknown>),
          ...rawEngineeringDraft,
          ...rawIssuePatch,
        }
        : (Object.keys({ ...rawEngineeringDraft, ...rawIssuePatch }).length ? { ...rawEngineeringDraft, ...rawIssuePatch } : null);
      const rawInferredType = typeof parsedJson.inferredType === 'string'
        ? parsedJson.inferredType
        : undefined;

      try {
        const parsed = skillExecutionSchema.parse(parsedJson);
        return {
          parsed,
          draftPatch: parsed.draftPatch
            ? {
              ...parsed.draftPatch,
              ...(parsed.engineeringDraft ? { engineeringDraft: parsed.engineeringDraft } : {}),
              ...(parsed.skillState ? { skillState: parsed.skillState } : {}),
              ...(parsed.draftIssues ? { draftIssues: parsed.draftIssues } : {}),
            }
            : rawDraftPatch,
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

  private looksLikeTopLevelEngineeringDraft(parsed: Record<string, unknown>): boolean {
    if (
      parsed.engineeringDraft && typeof parsed.engineeringDraft === 'object' && !Array.isArray(parsed.engineeringDraft)
      || parsed.draftPatch && typeof parsed.draftPatch === 'object' && !Array.isArray(parsed.draftPatch)
    ) {
      return false;
    }
    return (
      Boolean(parsed.geometry && typeof parsed.geometry === 'object' && !Array.isArray(parsed.geometry))
      || Boolean(parsed.material && typeof parsed.material === 'object' && !Array.isArray(parsed.material))
      || Boolean(parsed.sections && typeof parsed.sections === 'object' && !Array.isArray(parsed.sections))
      || Boolean(parsed.boundary && typeof parsed.boundary === 'object' && !Array.isArray(parsed.boundary))
      || Array.isArray(parsed.loads)
      || Boolean(parsed.analysis && typeof parsed.analysis === 'object' && !Array.isArray(parsed.analysis))
    );
  }
}
