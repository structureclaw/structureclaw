import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
import type { DraftState } from '../agent-skills/runtime/index.js';
import { logger } from '../utils/logger.js';

export function normalizeNoSkillDraftState(_state: DraftState): DraftState {
  return {
    inferredType: 'unknown',
    skillId: undefined,
    scenarioKey: undefined,
    supportLevel: undefined,
    supportNote: undefined,
    skillState: undefined,
    updatedAt: Date.now(),
  };
}

export function computeNoSkillMissingFields(): string[] {
  return ['可计算结构模型JSON，或完整自然语言结构描述（几何、边界、材料、截面、荷载、组合）'];
}

export async function tryNoSkillLlmBuildGenericModel(
  llm: ChatOpenAI | null,
  message: string,
  state: DraftState,
  locale: AppLocale,
): Promise<Record<string, unknown> | undefined> {
  if (!llm) {
    return undefined;
  }

  const stateHint = JSON.stringify(state);
  const template = buildStructureModelV1Template();
  const basePrompt = locale === 'zh'
    ? [
        '你是结构建模专家。',
        '请根据用户描述输出可计算的 StructureModel v1 JSON。',
        '只输出 JSON 对象，不要 Markdown。',
        '以下 1.0.0 JSON 模板是核心格式，请严格遵循键名与层级。',
        `模板:\n${template}`,
        '必须使用 StructureModel v1 字段，至少包含: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations。',
        '节点字段必须是 id, x, y, z, restraints(可选)。不要使用 coordinates 或 boundary_conditions。',
        '单元字段必须是 id, type, nodes, material, section。不要使用 material_id 或 section_id。',
        '材料字段必须是 id, name, E, nu, rho, fy(可选)。不要使用 elastic_modulus、poisson_ratio、density、yield_strength。',
        '截面字段必须有 id, name, type, properties。',
        '工况字段必须包含 id, type, loads。',
        '工况 type 只能是 dead、live、wind、seismic、other 之一。',
        '节点荷载推荐示例：{"type":"nodal_force","node":"N2","fx":0,"fy":-10,"fz":0,"mx":0,"my":0,"mz":0}。',
        '单元均布荷载推荐示例：{"type":"distributed","element":"E1","wy":-10000,"wz":0}。',
        '局部范围均布荷载不要在单个单元内部写起止位置，应通过拆分单元后，仅对目标单元施加 distributed 荷载来表达。',
        '不要使用 line_load、element_uniform_load、element_distributed_load、uniform_load 等其他单元均布荷载类型名。',
        '荷载组合字段必须是 { id, factors }，其中 factors 是 load_case_id 到系数的映射。不要使用 combinations 数组。',
        'schema_version 固定写为 "1.0.0"。',
        `已有草模信息: ${stateHint}`,
        `用户输入: ${message}`,
      ].join('\n')
    : [
        'You are a structural modeling expert.',
        'Generate a computable StructureModel v1 JSON from the user request.',
        'Return JSON object only, without markdown.',
        'The 1.0.0 JSON template below is the base format. Follow its keys and nesting strictly.',
        `Template:\n${template}`,
        'Use strict StructureModel v1 fields. At minimum include: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations.',
        'Node fields must be id, x, y, z, restraints(optional). Do not use coordinates or boundary_conditions.',
        'Element fields must be id, type, nodes, material, section. Do not use material_id or section_id.',
        'Material fields must be id, name, E, nu, rho, fy(optional). Do not use elastic_modulus, poisson_ratio, density, or yield_strength.',
        'Section fields must include id, name, type, and properties.',
        'Load case fields must include id, type, and loads.',
        'Load case type must be one of dead, live, wind, seismic, other.',
        'Nodal load example: {"type":"nodal_force","node":"N2","fx":0,"fy":-10,"fz":0,"mx":0,"my":0,"mz":0}.',
        'Element distributed load example: {"type":"distributed","element":"E1","wy":-10000,"wz":0}.',
        'For partial-span distributed loads, do not place start/end fields inside a single element. Split the member into multiple elements and assign distributed load only to the target element(s).',
        'Do not use line_load, element_uniform_load, element_distributed_load, or uniform_load as element distributed load type names.',
        'Load combination entries must be { id, factors } where factors maps load_case_id to factor. Do not use a combinations array.',
        'schema_version must be "1.0.0".',
        `Current draft hints: ${stateHint}`,
        `User request: ${message}`,
      ].join('\n');

  const retrySuffix = locale === 'zh'
    ? '\n上一轮输出未通过 JSON 校验。请仅返回合法 JSON 对象。'
    : '\nThe previous output did not pass JSON validation. Return a valid JSON object only.';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? basePrompt : `${basePrompt}${retrySuffix}`;
    const startedAt = Date.now();
    logger.info({
      attempt: attempt + 1,
      locale,
      promptChars: prompt.length,
      stateHintChars: stateHint.length,
      messagePreview: message.slice(0, 160),
    }, 'no-skill llm draft attempt started');

    try {
      const aiMessage = await llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      const parsed = parseJsonObject(content);
      if (!parsed) {
        logger.warn({
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          responseChars: content.length,
          responsePreview: content.slice(0, 200),
        }, 'no-skill llm draft returned non-json content');
        continue;
      }

      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.elements) || !Array.isArray(parsed.load_cases)) {
        logger.warn({
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          hasNodes: Array.isArray(parsed.nodes),
          hasElements: Array.isArray(parsed.elements),
          hasLoadCases: Array.isArray(parsed.load_cases),
        }, 'no-skill llm draft returned json without required structural arrays');
        continue;
      }

      if (typeof parsed.schema_version !== 'string') {
        parsed.schema_version = '1.0.0';
      }
      if (typeof parsed.unit_system !== 'string') {
        parsed.unit_system = 'SI';
      }

      logger.info({
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        nodeCount: parsed.nodes.length,
        elementCount: parsed.elements.length,
        loadCaseCount: parsed.load_cases.length,
      }, 'no-skill llm draft attempt succeeded');

      return parsed;
    } catch (error) {
      logger.warn({
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }, 'no-skill llm draft attempt failed with upstream error');
      continue;
    }
  }

  logger.warn({
    locale,
    promptChars: basePrompt.length,
    messagePreview: message.slice(0, 160),
  }, 'no-skill llm draft exhausted all attempts without a valid model');

  return undefined;
}

function buildStructureModelV1Template(): string {
  return JSON.stringify({
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes: [
      {
        id: 'N1',
        x: 0,
        y: 0,
        z: 0,
        restraints: [true, true, true, false, false, false],
      },
      {
        id: 'N2',
        x: 10,
        y: 0,
        z: 0,
      },
    ],
    elements: [
      {
        id: 'E1',
        type: 'beam',
        nodes: ['N1', 'N2'],
        material: 'MAT1',
        section: 'SEC1',
      },
    ],
    materials: [
      {
        id: 'MAT1',
        name: 'Steel_Q235',
        E: 206000,
        nu: 0.3,
        rho: 7850,
        fy: 235,
      },
    ],
    sections: [
      {
        id: 'SEC1',
        name: 'Rect_200x400',
        type: 'rectangular',
        properties: {
          width: 0.2,
          height: 0.4,
          A: 0.08,
          Iy: 0.000266667,
          Iz: 0.001066667,
        },
      },
    ],
    load_cases: [
      {
        id: 'LC1',
        type: 'other',
        loads: [
          {
            type: 'nodal_force',
            node: 'N2',
            fx: 0,
            fy: -10,
            fz: 0,
            mx: 0,
            my: 0,
            mz: 0,
          },
          {
            type: 'distributed',
            element: 'E1',
            wx: 0,
            wy: -10000,
            wz: 0,
          },
        ],
      },
    ],
    load_combinations: [
      {
        id: 'COMB1',
        factors: {
          LC1: 1.0,
        },
      },
    ],
  }, null, 2);
}


function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return tryParseJson(fenced[1]);
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return tryParseJson(trimmed.slice(first, last + 1));
  }
  return null;
}

function tryParseJson(content: string): Record<string, unknown> | null {
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
