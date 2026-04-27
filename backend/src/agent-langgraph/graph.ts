/**
 * LangGraph StateGraph for the StructureClaw ReAct agent.
 *
 * Graph structure:
 *   START → agent (LLM reasoning) → [has tool_calls?]
 *     → Yes  → tools (execute tool) → agent (loop back)
 *     → No   → END (final response)
 *
 * Dependency injection: services are passed via config.configurable
 * (AgentConfigurable) so tools and nodes never read globalThis.
 *
 * Artifact-writing tools return Command({ update }) objects to write
 * directly into graph state channels — no intermediary node needed.
 */
import {
  StateGraph,
  START,
  END,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createChatModel } from '../utils/llm.js';
import { AgentStateAnnotation, type AgentState } from './state.js';
import { createRegisteredTools, type AgentToolFactoryDeps } from './tool-registry.js';
import { loadUserTools } from './user-tool-loader.js';
import { getWorkspaceToolRoot } from './config.js';
import { buildSystemMessages } from './system-prompt.js';
import type { SkillManifest } from '../agent-runtime/types.js';
import type { AgentConfigurable } from './configurable.js';
import { resolveActiveToolIds } from './tool-policy.js';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getLogger } from '../utils/agent-logger.js';

function getAgentLogger(config: LangGraphRunnableConfig) {
  return getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
}

// ---------------------------------------------------------------------------
// Max ReAct iterations guard
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS_PER_TURN = 15;

// ---------------------------------------------------------------------------
// Node: agent (LLM reasoning)
// ---------------------------------------------------------------------------

function createCallModelNode(
  skillManifests: SkillManifest[],
  tools: ReturnType<typeof createRegisteredTools>,
) {
  return async function callModel(
    state: AgentState,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<AgentState>> {
    const log = getAgentLogger(config);
    const configurable = config.configurable as Partial<AgentConfigurable> | undefined;
    const model = createChatModel(0);
    if (!model) {
      return {
        messages: [
          new AIMessage(
            state.locale === 'zh'
              ? 'LLM 未配置，无法处理请求。请检查 LLM_API_KEY 设置。'
              : 'LLM is not configured. Please check LLM_API_KEY settings.',
          ),
        ],
      };
    }

    const skillRuntime = configurable?.skillRuntime;
    if (!skillRuntime) {
      return {
        messages: [
          new AIMessage(
            state.locale === 'zh'
              ? '技能运行时未配置。'
              : 'Skill runtime is not configured.',
          ),
        ],
      };
    }

    const activeTools = resolveActiveTools(tools, configurable);
    const modelWithTools = model.bindTools(activeTools);

    // Build system prompt
    const systemMessages = buildSystemMessages({ state, skillManifests });

    // Validate and reconstruct messages — checkpoint deserialization may
    // strip class methods (_getType), leaving plain objects that the LLM API
    // rejects with "role information cannot be empty". Rebuild them here.
    const rawMsgs: BaseMessage[] = Array.isArray(state.messages) ? state.messages : [];
    const msgs: BaseMessage[] = rawMsgs.map((m): BaseMessage | null => {
      if (m == null || typeof m !== 'object') return null;
      // Check if already a proper class instance with a usable role.
      // ChatMessageChunk / ChatMessage with _getType "generic" and missing
      // role must be reconstructed — the LLM provider rejects them.
      if (typeof (m as any)._getType === 'function') {
        const t = (m as any)._getType();
        if (t === 'generic') {
          // ChatMessage(ChatChunk) — treat as AI if role is missing/assistant
          const role = (m as any).role;
          if (role === 'assistant' || !role) {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
            if (!content) return null;
            return new AIMessage({ content });
          }
        }
        // AIMessageChunk is not a proper AIMessage — convert it so the LLM
        // provider receives a message with a well-defined role.  Chunk
        // instances have undefined .role which causes "角色信息不能为空"
        // errors on some providers (e.g. GLM).
        if (t === 'ai' && !(m instanceof AIMessage)) {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
          // Skip empty AIMessageChunks — they are streaming artifacts
          // (e.g. the final empty chunk after tool calls) with no value.
          if (!content) return null;
          const aiMsg = new AIMessage({ content, name: (m as any).name || undefined });
          if (Array.isArray((m as any).tool_calls)) (aiMsg as any).tool_calls = (m as any).tool_calls;
          return aiMsg;
        }
        return m;
      }
      // Normalize: LangChain serde uses {lc:1, type:"constructor", id:[...], kwargs:{...}}
      const raw = m as unknown as Record<string, unknown>;
      const isLcFormat = raw.lc === 1 && raw.type === 'constructor';
      const plain = isLcFormat ? (raw.kwargs as Record<string, unknown>) ?? {} : raw;
      const lcId = Array.isArray(raw.id) ? (raw.id as string[]).join('/') : '';
      const id = lcId || (plain.id as string) || '';
      const content = plain.content ?? '';
      const name = plain.name as string | undefined;
      if (id.includes('HumanMessage') || plain.role === 'user' || plain.type === 'human') {
        return typeof content === 'string' ? new HumanMessage({ content, name }) : new HumanMessage({ content: content as any[], name });
      }
      if (id.includes('AIMessage') || plain.role === 'assistant' || plain.type === 'ai') {
        const aiMsg = typeof content === 'string' ? new AIMessage({ content, name }) : new AIMessage({ content: content as any[], name });
        if (Array.isArray(plain.tool_calls)) (aiMsg as any).tool_calls = plain.tool_calls;
        return aiMsg;
      }
      if (id.includes('SystemMessage') || plain.role === 'system' || plain.type === 'system') {
        return new SystemMessage(typeof content === 'string' ? content : JSON.stringify(content));
      }
      if (id.includes('ToolMessage') || plain.role === 'tool' || plain.type === 'tool') {
        return new ToolMessage({
          content: typeof content === 'string' ? content : JSON.stringify(content),
          tool_call_id: (plain.tool_call_id as string) || (plain.id as string) || '',
          name,
        });
      }
      // Unknown — skip
      return null;
    }).filter((m): m is BaseMessage => m !== null);

    // Count prior tool calls in this turn to enforce max iterations.
    let lastHumanIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (typeof m === 'object' && m !== null && '_getType' in m && (m as any)._getType?.() === 'human') {
        lastHumanIndex = i;
        break;
      }
    }
    const currentTurnMessages = lastHumanIndex === -1 ? msgs : msgs.slice(lastHumanIndex + 1);
    const toolCallCount = currentTurnMessages.reduce((count, m) => {
      if (
        m != null
        && typeof m === 'object'
        && 'tool_calls' in m
        && Array.isArray((m as any).tool_calls)
      ) {
        return count + (m as any).tool_calls.length;
      }
      return count;
    }, 0);

    if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
      log.warn({ node: 'agent', toolCallCount, max: MAX_TOOL_CALLS_PER_TURN }, 'max tool call limit reached');
      const warning = state.locale === 'zh'
        ? '已达到本轮最大工具调用次数限制。我将根据已有信息给出回复。'
        : 'Reached the maximum tool call limit for this turn. I will respond with the information gathered so far.';
      return { messages: [new AIMessage(warning)] };
    }

    // Inject current state into configurable so tools can read state channels.
    // Tools access it via config.configurable.agentState.
    // IMPORTANT: mutate config.configurable in-place so the ToolNode (which
    // receives the same config object) also sees agentState.
    const configurableAny = config.configurable as Record<string, unknown>;
    configurableAny.agentState = state;

    const allMessages = [...systemMessages, ...msgs];

    log.info({ node: 'agent', messageCount: allMessages.length, activeToolCount: activeTools.length, toolCallCount }, 'agent node invoking LLM');
    const llmStart = Date.now();
    const response = await modelWithTools.invoke(allMessages, config);
    const llmDuration = Date.now() - llmStart;

    const hasToolCalls = 'tool_calls' in response && Array.isArray((response as any).tool_calls) && (response as any).tool_calls.length > 0;
    log.info({ node: 'agent', durationMs: llmDuration, hasToolCalls }, 'agent node LLM response received');

    return { messages: [response] };
  };
}

// ---------------------------------------------------------------------------
// Conditional edge: should we continue or end?
// ---------------------------------------------------------------------------

function shouldContinue(
  state: AgentState,
): 'tools' | typeof END {
  const msgs = Array.isArray(state.messages) ? state.messages : [];
  const lastMessage = msgs[msgs.length - 1];
  const hasToolCalls = (
    lastMessage != null &&
    'tool_calls' in lastMessage &&
    Array.isArray((lastMessage as any).tool_calls) &&
    (lastMessage as any).tool_calls.length > 0
  );
  return hasToolCalls ? 'tools' : END;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export interface GraphDeps extends AgentToolFactoryDeps {
  skillManifests: SkillManifest[];
  checkpointer?: BaseCheckpointSaver;
}

function resolveActiveTools(
  tools: StructuredToolInterface[],
  configurable: Partial<AgentConfigurable> | undefined,
): StructuredToolInterface[] {
  const result = resolveActiveToolIds({
    requestedEnabledToolIds: configurable?.enabledToolIds,
    requestedDisabledToolIds: configurable?.disabledToolIds,
    allowShell: configurable?.allowShell ?? false,
  });
  const activeIds = new Set(result.activeToolIds);
  return tools.filter((toolDefinition) => activeIds.has(toolDefinition.name));
}

export async function buildAgentGraph(deps: GraphDeps) {
  const { skillManifests, checkpointer } = deps;

  // Load user-defined tools from workspace
  let userToolDefinitions: import('./tool-registry.js').AgentToolDefinition[] = [];
  try {
    const workspaceToolRoot = getWorkspaceToolRoot();
    const result = await loadUserTools(workspaceToolRoot);
    userToolDefinitions = result.tools;
    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        console.warn(`[user-tools] Failed to load tool from ${failure.toolDir}: ${failure.reason} ${failure.detail ?? ''}`);
      }
    }
  } catch (err) {
    console.warn(`[user-tools] Failed to scan workspace tools: ${err instanceof Error ? err.message : err}`);
  }

  // Create tools ONCE — shared between ToolNode and callModel
  const tools = createRegisteredTools({ skillRuntime: deps.skillRuntime, workspaceRoot: deps.workspaceRoot }, userToolDefinitions);
  const callModel = createCallModelNode(skillManifests, tools);

  const log = getLogger(undefined);
  log.info({ toolCount: tools.length, hasCheckpointer: !!checkpointer }, 'building agent graph');

  // Wrap ToolNode so that the current graph state is injected into
  // config.configurable.agentState before each tool runs.  LangGraph
  // does not propagate config mutations across nodes, so the injection
  // done in callModel is invisible to the raw ToolNode.
  const toolsNode = async (state: AgentState, config: LangGraphRunnableConfig) => {
    const nodeLog = getAgentLogger(config);
    const configurableAny = config.configurable as Record<string, unknown>;
    configurableAny.agentState = state;
    // Resolve skill scope once for all tools in this invocation
    configurableAny.skillScope = state.selectedSkillIds?.length
      ? state.selectedSkillIds
      : undefined;
    const activeTools = resolveActiveTools(
      tools,
      config.configurable as Partial<AgentConfigurable> | undefined,
    );
    nodeLog.debug({ node: 'tools', activeToolCount: activeTools.length }, 'tools node executing');
    const toolNode = new ToolNode(activeTools);
    return toolNode.invoke(state, config);
  };

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent');

  return workflow.compile({ checkpointer });
}
