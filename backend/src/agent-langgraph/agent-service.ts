/**
 * LangGraph-based AgentService — the sole agent implementation.
 *
 * Provides streaming, synchronous, and resumption entry points for the
 * LangGraph ReAct agent, plus conversation/session management methods
 * previously handled by the legacy AgentService.
 */
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { SkillManifest } from '../agent-runtime/types.js';
import { buildAgentGraph } from './graph.js';
import { FileCheckpointer } from './file-checkpointer.js';
import { streamGraphToChunks, type StreamContext } from './streaming.js';
import { type AgentState } from './state.js';
import { getCheckpointerDataDir, getWorkspaceRoot } from './config.js';
import type { AgentStreamChunk } from '../types/agent-stream.js';
import type { AppLocale } from '../services/locale.js';
import { createLocalAnalysisEngineClient } from '../services/analysis-execution.js';
import { createLocalCodeCheckClient } from '../services/code-check-execution.js';
import { createLocalStructureProtocolClient } from '../services/structure-protocol-execution.js';
import { prisma } from '../utils/database.js';
// Workaround: moduleResolution "node" doesn't support package.json exports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { Command } from '../../node_modules/@langchain/langgraph/dist/constants.js';
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
  // Core fields (used by /message and /run endpoints)
  conversationId: string;
  traceId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  response: string;
  mode: 'conversation' | 'execution';
  toolCalls: unknown[];
  // Optional domain artifacts
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

    // Expose skillRuntime and execution clients globally for tool factories.
    // TODO: Replace with proper DI via LangGraph config.configurable.
    (globalThis as any).__skillRuntime = skillRuntime;
    (globalThis as any).__engineClient = createLocalAnalysisEngineClient();
    (globalThis as any).__codeCheckClient = createLocalCodeCheckClient();
    (globalThis as any).__structureProtocolClient = createLocalStructureProtocolClient();
  }

  // ---------------------------------------------------------------------------
  // Conversation auto-creation
  // ---------------------------------------------------------------------------

  private async ensureConversationRecord(
    conversationId: string | undefined,
    userId: string | undefined,
    message: string,
  ): Promise<string> {
    if (conversationId) return conversationId;

    const conversation = await prisma.conversation.create({
      data: {
        title: message.slice(0, 50),
        type: 'general',
        userId: userId || undefined,
      },
    });
    return conversation.id;
  }

  // ---------------------------------------------------------------------------
  // Graph construction helper
  // ---------------------------------------------------------------------------

  private async buildGraph() {
    const skillManifests = await this.skillRuntime.listSkillManifests();
    return buildAgentGraph({
      skillRuntime: this.skillRuntime,
      skillManifests,
      checkpointer: this.checkpointer,
    });
  }

  // ---------------------------------------------------------------------------
  // Streaming entry point
  // ---------------------------------------------------------------------------

  async *runStream(input: LangGraphRunInput): AsyncGenerator<AgentStreamChunk> {
    const locale = input.context?.locale || 'zh';
    const conversationId = await this.ensureConversationRecord(
      input.conversationId, input.userId, input.message,
    );
    const skillIds = input.context?.skillIds || [];
    const traceId = input.traceId || randomUUID();
    const startedAt = new Date().toISOString();

    const graph = await this.buildGraph();

    const config = {
      configurable: { thread_id: conversationId },
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
      { ...config, streamMode: ['messages', 'updates', 'custom'] as any },
    );

    const ctx: StreamContext = { conversationId, traceId, startedAt };
    yield* streamGraphToChunks(stream, ['messages', 'updates', 'custom'], ctx);
  }

  // ---------------------------------------------------------------------------
  // Resume after interrupt
  // ---------------------------------------------------------------------------

  async *resumeStream(
    conversationId: string,
    resumeValue: string,
  ): AsyncGenerator<AgentStreamChunk> {
    const traceId = randomUUID();
    const startedAt = new Date().toISOString();

    const graph = await this.buildGraph();

    const config = {
      configurable: { thread_id: conversationId },
    };

    logger.info({ conversationId }, 'LangGraph agent resume');

    const stream = await graph.stream(
      new Command({ resume: resumeValue }),
      { ...config, streamMode: ['messages', 'updates', 'custom'] as any },
    );

    const ctx: StreamContext = { conversationId, traceId, startedAt };
    yield* streamGraphToChunks(stream, ['messages', 'updates', 'custom'], ctx);
  }

  // ---------------------------------------------------------------------------
  // Synchronous entry point
  // ---------------------------------------------------------------------------

  async run(input: LangGraphRunInput): Promise<LangGraphRunResult> {
    const locale = input.context?.locale || 'zh';
    const conversationId = await this.ensureConversationRecord(
      input.conversationId, input.userId, input.message,
    );
    const skillIds = input.context?.skillIds || [];
    const traceId = input.traceId || randomUUID();
    const startedAt = new Date().toISOString();

    const graph = await this.buildGraph();

    const config = {
      configurable: { thread_id: conversationId },
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

    return this.extractResult(result, conversationId, traceId, startedAt);
  }

  // ---------------------------------------------------------------------------
  // Session management (replaces legacy AgentService methods)
  // ---------------------------------------------------------------------------

  /**
   * Get a conversation's session state from the LangGraph checkpoint.
   * Used by GET /conversation/:id.
   */
  async getConversationSessionSnapshot(
    conversationId: string,
    _locale: AppLocale,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const tuple = await this.checkpointer.getTuple({
        configurable: { thread_id: conversationId },
      });
      if (!tuple?.checkpoint) return undefined;

      // Extract state from checkpoint channel_values
      const channelValues = (tuple.checkpoint as any).channel_values ||
        (tuple.checkpoint as any).channelValues || {};

      return {
        draft: channelValues.draftState || null,
        interaction: {
          state: 'ready',
          stage: 'model',
          turnId: conversationId,
        },
        model: undefined,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.debug({ conversationId, error }, 'Failed to load session snapshot');
      return undefined;
    }
  }

  /**
   * Clear conversation session by deleting all checkpoint files.
   * Used by DELETE /conversation/:id.
   */
  async clearConversationSession(conversationId: string): Promise<void> {
    await this.checkpointer.deleteThread(conversationId);
  }

  /**
   * List available skills.
   * Used by GET /skills.
   */
  async listSkills(): Promise<{ skills: SkillManifest[] }> {
    const manifests = await this.skillRuntime.listSkillManifests();
    return { skills: manifests };
  }

  /**
   * Get the agent protocol (tool schemas).
   * Used by GET /tools.
   */
  static getProtocol(): { tools: Array<{ name: string; description: string }> } {
    // Build a lightweight protocol description without instantiating the full tool set.
    // The full tools are created per-request in graph.ts.
    return {
      tools: [
        { name: 'detect_structure_type', description: 'Detect structural type from user description' },
        { name: 'extract_draft_params', description: 'Extract engineering parameters from user message' },
        { name: 'build_model', description: 'Build structural model from draft state' },
        { name: 'validate_model', description: 'Validate structural model' },
        { name: 'run_analysis', description: 'Execute structural analysis' },
        { name: 'run_code_check', description: 'Run code compliance check' },
        { name: 'generate_report', description: 'Generate engineering report' },
        { name: 'ask_user_clarification', description: 'Ask user for clarification' },
        { name: 'read_workspace_file', description: 'Read file from workspace' },
        { name: 'write_workspace_file', description: 'Write file to workspace' },
        { name: 'list_workspace_files', description: 'List workspace directory' },
        { name: 'update_session_config', description: 'Update session configuration' },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Result extraction
  // ---------------------------------------------------------------------------

  private extractResult(
    finalState: AgentState,
    conversationId: string,
    traceId: string,
    startedAt: string,
  ): LangGraphRunResult {
    const messages = Array.isArray(finalState.messages) ? finalState.messages : [];
    const lastMessage = messages[messages.length - 1];

    let response = '';
    if (lastMessage && 'content' in lastMessage) {
      response = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }

    const toolCalls: unknown[] = [];
    for (const msg of messages) {
      if (msg && typeof msg === 'object' && 'tool_calls' in msg) {
        const tc = (msg as any).tool_calls;
        if (Array.isArray(tc)) toolCalls.push(...tc);
      }
    }

    return {
      conversationId,
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      success: true,
      response,
      mode: toolCalls.length > 0 ? 'execution' : 'conversation',
      toolCalls,
      draftState: finalState.draftState ?? undefined,
    };
  }
}
