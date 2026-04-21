/**
 * LangGraph-based AgentService adapter.
 *
 * Replaces the core of AgentService.runStream() with a LangGraph ReAct agent
 * while preserving the same SSE stream interface.
 */
import { HumanMessage, type BaseMessage, AIMessage } from '@langchain/core/messages';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import { buildAgentGraph } from './graph.js';
import { FileCheckpointer } from './file-checkpointer.js';
import { streamGraphToChunks } from './streaming.js';
import { emptySessionState, type AgentState } from './state.js';
import { getCheckpointerDataDir, getWorkspaceRoot } from './config.js';
import type { AgentStreamChunk } from '../services/agent.js';
import type { AppLocale } from '../services/locale.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LangGraphRunInput {
  message: string;
  conversationId?: string;
  traceId?: string;
  userId?: string;
  signal?: AbortSignal;
  context?: {
    locale?: AppLocale;
    projectId?: string;
    skillIds?: string[];
    enabledToolIds?: string[];
    disabledToolIds?: string[];
    model?: Record<string, unknown>;
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    engineId?: string;
    designCode?: string;
    includeReport?: boolean;
    [key: string]: unknown;
  };
}

export interface LangGraphRunResult {
  summary: string;
  mode: 'conversation' | 'execution';
  toolCalls: unknown[];
  model?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  report?: Record<string, unknown>;
  draftState?: Record<string, unknown>;
  presentation?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class LangGraphAgentService {
  private readonly skillRuntime: AgentSkillRuntime;
  private readonly checkpointer: FileCheckpointer;
  private readonly workspaceRoot: string;

  constructor(skillRuntime: AgentSkillRuntime) {
    this.skillRuntime = skillRuntime;
    this.checkpointer = new FileCheckpointer(getCheckpointerDataDir());
    this.workspaceRoot = getWorkspaceRoot();

    // Expose skillRuntime globally for tool factories
    // (tools need access but can't receive it via state in the current MVP)
    (globalThis as any).__skillRuntime = skillRuntime;
  }

  /**
   * Run the agent with streaming.
   * Yields AgentStreamChunk events compatible with the existing SSE endpoint.
   */
  async *runStream(input: LangGraphRunInput): AsyncGenerator<AgentStreamChunk> {
    const locale = input.context?.locale || 'zh';
    const conversationId = input.conversationId || `thread-${Date.now()}`;
    const skillIds = input.context?.skillIds || [];

    const skillManifests = await this.skillRuntime.listSkillManifests();

    const graph = buildAgentGraph({
      skillRuntime: this.skillRuntime,
      skillManifests,
    });

    const config = {
      configurable: {
        thread_id: conversationId,
      },
    };

    logger.info({ conversationId, message: input.message.slice(0, 100) }, 'LangGraph agent stream');

    const stream = await graph.stream(
      {
        messages: [new HumanMessage(input.message)],
        locale,
        workspaceRoot: this.workspaceRoot,
        selectedSkillIds: skillIds,
        lastUserMessage: input.message,
        policy: {
          analysisType: input.context?.analysisType,
          designCode: input.context?.designCode,
        },
      },
      { ...config, streamMode: ['updates', 'custom'] as any },
    );

    yield* streamGraphToChunks(stream, ['updates', 'custom']);
  }

  /**
   * Run the agent synchronously (non-streaming).
   * Returns the final result after the ReAct loop completes.
   */
  async run(input: LangGraphRunInput): Promise<LangGraphRunResult> {
    const locale = input.context?.locale || 'zh';
    const conversationId = input.conversationId || `thread-${Date.now()}`;
    const skillIds = input.context?.skillIds || [];

    const skillManifests = await this.skillRuntime.listSkillManifests();

    const graph = buildAgentGraph({
      skillRuntime: this.skillRuntime,
      skillManifests,
    });

    const config = {
      configurable: {
        thread_id: conversationId,
      },
    };

    logger.info({ conversationId, message: input.message.slice(0, 100) }, 'LangGraph agent run');

    const result = await graph.invoke(
      {
        messages: [new HumanMessage(input.message)],
        locale,
        workspaceRoot: this.workspaceRoot,
        selectedSkillIds: skillIds,
        lastUserMessage: input.message,
        policy: {
          analysisType: input.context?.analysisType,
          designCode: input.context?.designCode,
        },
      },
      config,
    );

    return this.extractResult(result);
  }

  // ---------------------------------------------------------------------------
  // Result extraction
  // ---------------------------------------------------------------------------

  private extractResult(finalState: AgentState): LangGraphRunResult {
    const messages = Array.isArray(finalState.messages) ? finalState.messages : [];
    const lastMessage = messages[messages.length - 1];

    let summary = '';
    if (lastMessage && 'content' in lastMessage) {
      summary = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }

    // Collect tool call info from the message history
    const toolCalls: unknown[] = [];
    for (const msg of messages) {
      if (msg && typeof msg === 'object' && 'tool_calls' in msg) {
        const tc = (msg as any).tool_calls;
        if (Array.isArray(tc)) toolCalls.push(...tc);
      }
    }

    return {
      summary,
      mode: toolCalls.length > 0 ? 'execution' : 'conversation',
      toolCalls,
      draftState: finalState.draftState ?? undefined,
    };
  }
}
