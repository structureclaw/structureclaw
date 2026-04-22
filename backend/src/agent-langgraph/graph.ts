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
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createChatModel } from '../utils/llm.js';
import { AgentStateAnnotation, type AgentState } from './state.js';
import { createAllTools, type ToolDeps } from './tools.js';
import { buildSystemMessages } from './system-prompt.js';
import type { SkillManifest } from '../agent-runtime/types.js';
import type { AgentConfigurable } from './configurable.js';

// ---------------------------------------------------------------------------
// Max ReAct iterations guard
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS_PER_TURN = 15;

// ---------------------------------------------------------------------------
// Node: agent (LLM reasoning)
// ---------------------------------------------------------------------------

function createCallModelNode(
  skillManifests: SkillManifest[],
  tools: ReturnType<typeof createAllTools>,
) {
  return async function callModel(
    state: AgentState,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<AgentState>> {
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

    // Bind tools to model (tools are shared, created once in buildAgentGraph)
    const modelWithTools = model.bindTools(tools);

    // Build system prompt
    const systemMessages = buildSystemMessages({ state, skillManifests });

    // Validate messages — skip any that lost class identity during
    // checkpoint deserialization (they won't have _getType() and would
    // cause "role information cannot be empty" from the LLM API).
    const rawMsgs: BaseMessage[] = Array.isArray(state.messages) ? state.messages : [];
    const msgs: BaseMessage[] = rawMsgs.filter((m) =>
      m != null
      && typeof m === 'object'
      && typeof (m as any)._getType === 'function',
    );

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
    const response = await modelWithTools.invoke(allMessages, config);

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
  if (
    lastMessage != null &&
    'tool_calls' in lastMessage &&
    Array.isArray((lastMessage as any).tool_calls) &&
    (lastMessage as any).tool_calls.length > 0
  ) {
    return 'tools';
  }
  return END;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export interface GraphDeps extends ToolDeps {
  skillManifests: SkillManifest[];
  checkpointer?: BaseCheckpointSaver;
}

export function buildAgentGraph(deps: GraphDeps) {
  const { skillManifests, checkpointer } = deps;

  // Create tools ONCE — shared between ToolNode and callModel
  const tools = createAllTools({ skillRuntime: deps.skillRuntime });
  const toolNode = new ToolNode(tools);

  const callModel = createCallModelNode(skillManifests, tools);

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent');

  return workflow.compile({ checkpointer });
}
