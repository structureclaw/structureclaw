import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
import type { DraftState } from '../agent-skills/runtime/index.js';

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
  const basePrompt = locale === 'zh'
    ? [
        '你是结构建模专家。',
        '请根据用户描述输出可计算的 StructureModel v1 JSON。',
        '只输出 JSON 对象，不要 Markdown。',
        '必须使用 StructureModel v1 字段，至少包含: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations。',
        '节点字段必须是 id, x, y, z, restraints(可选)。不要使用 coordinates 或 boundary_conditions。',
        '单元字段必须是 id, type, nodes, material, section。不要使用 material_id 或 section_id。',
        '材料字段必须是 id, name, E, nu, rho, fy(可选)。不要使用 elastic_modulus、poisson_ratio、density、yield_strength。',
        '荷载组合字段必须是 { id, factors }，其中 factors 是 load_case_id 到系数的映射。不要使用 combinations 数组。',
        'schema_version 固定写为 "1.0.0"。',
        `已有草模信息: ${stateHint}`,
        `用户输入: ${message}`,
      ].join('\n')
    : [
        'You are a structural modeling expert.',
        'Generate a computable StructureModel v1 JSON from the user request.',
        'Return JSON object only, without markdown.',
        'Use strict StructureModel v1 fields. At minimum include: schema_version, unit_system, nodes, elements, materials, sections, load_cases, load_combinations.',
        'Node fields must be id, x, y, z, restraints(optional). Do not use coordinates or boundary_conditions.',
        'Element fields must be id, type, nodes, material, section. Do not use material_id or section_id.',
        'Material fields must be id, name, E, nu, rho, fy(optional). Do not use elastic_modulus, poisson_ratio, density, or yield_strength.',
        'Load combination entries must be { id, factors } where factors maps load_case_id to factor. Do not use a combinations array.',
        'schema_version must be "1.0.0".',
        `Current draft hints: ${stateHint}`,
        `User request: ${message}`,
      ].join('\n');

  const retrySuffix = locale === 'zh'
    ? '\n上一轮输出未通过 JSON 校验。请仅返回合法 JSON 对象。'
    : '\nThe previous output did not pass JSON validation. Return a valid JSON object only.';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const prompt = attempt === 0 ? basePrompt : `${basePrompt}${retrySuffix}`;
      const aiMessage = await llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      const parsed = parseJsonObject(content);
      if (!parsed) {
        continue;
      }

      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.elements) || !Array.isArray(parsed.load_cases)) {
        continue;
      }

      if (typeof parsed.schema_version !== 'string') {
        parsed.schema_version = '1.0.0';
      }
      if (typeof parsed.unit_system !== 'string') {
        parsed.unit_system = 'SI';
      }

      return parsed;
    } catch {
      continue;
    }
  }

  return undefined;
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
