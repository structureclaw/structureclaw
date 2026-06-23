import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from '../services/locale.js';
import { buildStructuralTypeMatch } from './plugin-helpers.js';
import type {
  AgentSkillPlugin,
  DraftState,
  InferredModelType,
  StructuralTypeKey,
  StructuralTypeMatch,
  StructuralTypeSupportLevel,
} from './types.js';

type StructuralRouterAction = 'continue_current' | 'switch_skill' | 'generic' | 'ask';
type RouterLlm = Pick<ChatOpenAI, 'invoke'>;

interface StructuralRouterDecision {
  action?: StructuralRouterAction;
  skillId?: string;
  structuralTypeKey?: StructuralTypeKey;
  mappedType?: InferredModelType;
  supportLevel?: StructuralTypeSupportLevel;
  confidence?: number;
  reason?: string;
}

export interface StructuralRouterInput {
  llm: RouterLlm;
  message: string;
  locale: AppLocale;
  currentState?: DraftState;
  currentPlugin?: AgentSkillPlugin | null;
  plugins: AgentSkillPlugin[];
  ruleMatch?: StructuralTypeMatch;
  signal?: AbortSignal;
}

const MIN_ROUTER_CONFIDENCE = 0.55;
const ROUTER_OUTPUT_SCHEMA = '{ "action": "continue_current|switch_skill|generic|ask", "skillId": string, "structuralTypeKey": string, "mappedType": string, "supportLevel": "supported|fallback|unsupported", "confidence": number, "reason": string }';
const PROMPT_METADATA_KEYS = new Set([
  'updatedAt',
  'coordinateSemantics',
  'supportNote',
  'routingSource',
]);
const STRUCTURAL_TYPE_KEYS = new Set<StructuralTypeKey>([
  'beam',
  'column',
  'truss',
  'portal-frame',
  'double-span-beam',
  'frame',
  'steel-frame',
  'concrete-frame',
  'reinforced-concrete-frame',
  'portal',
  'girder',
  'space-frame',
  'plate-slab',
  'shell',
  'tower',
  'bridge',
  'unknown',
]);
const MODEL_TYPES = new Set<InferredModelType>([
  'beam',
  'column',
  'truss',
  'portal-frame',
  'double-span-beam',
  'frame',
  'unknown',
]);
const SUPPORT_LEVELS = new Set<StructuralTypeSupportLevel>(['supported', 'fallback', 'unsupported']);
const ACTIONS = new Set<StructuralRouterAction>(['continue_current', 'switch_skill', 'generic', 'ask']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = tryParseJsonObject(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsedFence = tryParseJsonObject(fenced[1]);
    if (parsedFence) return parsedFence;
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return tryParseJsonObject(trimmed.slice(first, last + 1));
  }
  return null;
}

function tryParseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cleanStateForPrompt(value: unknown, keyPath: string[] = []): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => cleanStateForPrompt(item, keyPath))
      .filter((item) => item !== undefined);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (isRecord(value)) {
    const key = keyPath[keyPath.length - 1];
    const entries = Object.entries(value)
      .filter(([entryKey]) => !PROMPT_METADATA_KEYS.has(entryKey))
      .filter(([entryKey]) => !(key === 'skillState' && entryKey === 'invalidDraftFields'))
      .map(([entryKey, item]) => [entryKey, cleanStateForPrompt(item, [...keyPath, entryKey])] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return 0;
}

function normalizeDecision(parsed: Record<string, unknown>): StructuralRouterDecision {
  const actionValue = getString(parsed.action);
  const keyValue = getString(parsed.structuralTypeKey ?? parsed.key);
  const mappedTypeValue = getString(parsed.mappedType ?? parsed.inferredType);
  const supportLevelValue = getString(parsed.supportLevel);
  return {
    action: actionValue && ACTIONS.has(actionValue as StructuralRouterAction)
      ? actionValue as StructuralRouterAction
      : undefined,
    skillId: getString(parsed.skillId),
    structuralTypeKey: keyValue && STRUCTURAL_TYPE_KEYS.has(keyValue as StructuralTypeKey)
      ? keyValue as StructuralTypeKey
      : undefined,
    mappedType: mappedTypeValue && MODEL_TYPES.has(mappedTypeValue as InferredModelType)
      ? mappedTypeValue as InferredModelType
      : undefined,
    supportLevel: supportLevelValue && SUPPORT_LEVELS.has(supportLevelValue as StructuralTypeSupportLevel)
      ? supportLevelValue as StructuralTypeSupportLevel
      : undefined,
    confidence: getConfidence(parsed.confidence),
    reason: getString(parsed.reason),
  };
}

function pluginForDecision(decision: StructuralRouterDecision, plugins: AgentSkillPlugin[]): AgentSkillPlugin | undefined {
  const key = decision.structuralTypeKey;
  const skillId = decision.skillId;
  return plugins.find((plugin) => plugin.id === skillId)
    || (key ? plugins.find((plugin) => plugin.manifest.structuralTypeKeys.includes(key)) : undefined)
    || (decision.mappedType ? plugins.find((plugin) => plugin.structureType === decision.mappedType) : undefined);
}

function buildCurrentStateMatch(
  state: DraftState,
  plugin: AgentSkillPlugin,
  supportNote?: string,
): StructuralTypeMatch {
  return {
    key: (state.structuralTypeKey ?? plugin.id) as StructuralTypeKey,
    mappedType: state.inferredType,
    skillId: plugin.id,
    supportLevel: state.supportLevel ?? 'supported',
    supportNote: supportNote ?? state.supportNote,
    routingSource: 'llm-suggested',
  };
}

function buildGenericMatch(locale: AppLocale, plugins: AgentSkillPlugin[], reason?: string): StructuralTypeMatch | null {
  const genericPlugin = plugins.find((plugin) => plugin.id === 'generic');
  if (!genericPlugin) return null;
  return buildStructuralTypeMatch('unknown', 'unknown', 'generic', 'fallback', locale, {
    zh: reason || '大模型判断当前描述不应被旧结构草稿锁定，先交给通用结构类型 skill 继续澄清。',
    en: reason || 'The LLM router decided this request should not be locked to the prior draft, so it will continue through the generic structure-type skill.',
  }, 'llm-suggested');
}

function resolveRouterMatch(
  decision: StructuralRouterDecision,
  input: StructuralRouterInput,
): StructuralTypeMatch | null {
  if ((decision.confidence ?? 0) < MIN_ROUTER_CONFIDENCE) {
    return null;
  }

  const action = decision.action
    ?? (decision.skillId || decision.structuralTypeKey ? 'switch_skill' : undefined);

  if (action === 'continue_current') {
    if (!input.currentState?.inferredType || input.currentState.inferredType === 'unknown' || !input.currentPlugin) {
      return null;
    }
    return buildCurrentStateMatch(input.currentState, input.currentPlugin, decision.reason);
  }

  if (action === 'generic' || action === 'ask') {
    return buildGenericMatch(input.locale, input.plugins, decision.reason);
  }

  if (action !== 'switch_skill') {
    return null;
  }

  const plugin = pluginForDecision(decision, input.plugins);
  if (!plugin) {
    return null;
  }
  if (plugin.id === 'generic') {
    return buildGenericMatch(input.locale, input.plugins, decision.reason);
  }

  const key = decision.structuralTypeKey
    ?? plugin.manifest.structuralTypeKeys[0]
    ?? plugin.structureType;
  const mappedType = decision.mappedType ?? plugin.structureType;
  const supportLevel = decision.supportLevel ?? 'supported';
  return buildStructuralTypeMatch(
    key as StructuralTypeKey,
    mappedType,
    plugin.id,
    supportLevel,
    input.locale,
    decision.reason ? { zh: decision.reason, en: decision.reason } : undefined,
    'llm-suggested',
  );
}

function buildPluginSummary(plugin: AgentSkillPlugin): Record<string, unknown> {
  return {
    id: plugin.id,
    structureType: plugin.structureType,
    structuralTypeKeys: plugin.manifest.structuralTypeKeys,
    name: plugin.name,
    description: plugin.description,
    triggers: plugin.triggers,
  };
}

function buildRouterPrompt(input: StructuralRouterInput): string {
  const stateJson = JSON.stringify(cleanStateForPrompt(input.currentState) ?? {}, null, 2);
  const skillsJson = JSON.stringify(input.plugins.map(buildPluginSummary), null, 2);
  const ruleMatchJson = JSON.stringify(input.ruleMatch ?? null, null, 2);
  const currentSkill = input.currentPlugin
    ? JSON.stringify(buildPluginSummary(input.currentPlugin), null, 2)
    : 'null';

  if (input.locale === 'zh') {
    return [
      '你是结构工程对话的结构类型路由器。请直接判断本轮用户消息应该继续当前 draft，切换到某个结构 skill，还是进入 generic 澄清。',
      '',
      '规则 hints 只是参考，不是最终裁判。不要因为存在 current draft 就自动继续；只有用户是在修改、补充、回答追问或明确引用当前模型时才 continue_current。',
      '如果最新消息像一个新的结构描述，尤其是从构件级草稿转到办公楼、柱网、楼层、体系描述，不要被旧 draft 锁定。',
      '“梁上荷载”里的梁通常是框架构件上下文，不一定要切到 beam；“柱网/柱距”里的柱通常不是单柱。',
      '',
      '只输出 JSON，不要 markdown。Schema:',
      ROUTER_OUTPUT_SCHEMA,
      '',
      'action 说明：',
      '- continue_current: 本轮是在继续修改已有 draft。',
      '- switch_skill: 本轮明确应使用某个可用 structure-type skill。',
      '- generic: 描述有结构意图，但不宜由具体 skill 硬判，先交给 generic。',
      '- ask: 信息不足以稳定判断，交给 generic 追问。',
      '',
      '可用 skills:',
      skillsJson,
      '',
      `当前 skill:\n${currentSkill}`,
      '',
      `当前 draftState:\n${stateJson}`,
      '',
      `规则 hint:\n${ruleMatchJson}`,
      '',
      `用户最新消息:\n${input.message}`,
    ].join('\n');
  }

  return [
    'You are the structural-type router for a structural engineering conversation. Decide whether the latest user message should continue the current draft, switch to a structure skill, or go to generic clarification.',
    '',
    'Rule hints are advisory, not authoritative. Do not continue the current draft just because it exists; continue only when the user is editing, supplementing, answering a clarification, or explicitly referring to the current model.',
    'If the latest message looks like a new structural description, especially a shift from a member draft to a building/grid/story/system description, do not lock it to the old draft.',
    'A beam mentioned in "load on the beam" may be member context inside a frame; a column mentioned in "column grid/spacing" is usually not a standalone column.',
    '',
    'Return JSON only, no markdown. Schema:',
    ROUTER_OUTPUT_SCHEMA,
    '',
    'Available skills:',
    skillsJson,
    '',
    `Current skill:\n${currentSkill}`,
    '',
    `Current draftState:\n${stateJson}`,
    '',
    `Rule hint:\n${ruleMatchJson}`,
    '',
    `Latest user message:\n${input.message}`,
  ].join('\n');
}

export async function invokeStructuralTypeRouter(input: StructuralRouterInput): Promise<StructuralTypeMatch | null> {
  try {
    const result = await input.llm.invoke(buildRouterPrompt(input), { signal: input.signal });
    const content = typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
    const parsed = parseJsonObject(content);
    if (!parsed) return null;
    return resolveRouterMatch(normalizeDecision(parsed), input);
  } catch {
    return null;
  }
}
