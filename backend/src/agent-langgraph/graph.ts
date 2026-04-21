/**
 * LangGraph StateGraph for the StructureClaw ReAct agent.
 *
 * Graph structure:
 *   START → agent (LLM reasoning) → [has tool_calls?]
 *     → Yes  → tools (execute tool) → agent (loop back)
 *     → No   → END (final response)
 *
 * This implements the core ReAct loop:
 *   Reason → Tool Selection → Execute → Observe → loop
 */
import {
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
// Workaround: moduleResolution "node" doesn't support package.json exports.
// Import directly from the resolved dist path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { ToolNode } from '../../node_modules/@langchain/langgraph/dist/prebuilt/index.js';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createChatModel } from '../utils/llm.js';
import { AgentStateAnnotation, type AgentState } from './state.js';
import { createAllTools, type ToolDeps } from './tools.js';
import { buildSystemMessages } from './system-prompt.js';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { SkillManifest } from '../agent-runtime/types.js';

// ---------------------------------------------------------------------------
// Max ReAct iterations guard
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS_PER_TURN = 15;

// ---------------------------------------------------------------------------
// Node: agent (LLM reasoning)
// ---------------------------------------------------------------------------

function createCallModelNode(skillManifests: SkillManifest[]) {
  return async function callModel(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
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

    const tools = createAllTools({ skillRuntime: (globalThis as any).__skillRuntime as AgentSkillRuntime });
    const modelWithTools = model.bindTools(tools);

    // Build system prompt
    const systemMessages = buildSystemMessages({ state, skillManifests });

    // Count prior tool calls in this turn to enforce max iterations.
    // Only count calls since the last HumanMessage (per-turn), and sum
    // individual tool_calls[].length rather than counting messages.
    const msgs: BaseMessage[] = Array.isArray(state.messages) ? state.messages : [];
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

    // Invoke LLM
    const allMessages = [...systemMessages, ...msgs];
    const response = await modelWithTools.invoke(allMessages);

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
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
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

  const tools = createAllTools({ skillRuntime: deps.skillRuntime });
  const toolNode = new ToolNode(tools);

  const callModel = createCallModelNode(skillManifests);

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent');

  return workflow.compile({ checkpointer });
}
