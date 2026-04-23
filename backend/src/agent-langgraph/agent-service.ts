/**
 * LangGraph-based AgentService — the sole agent implementation.
 *
 * Provides streaming, synchronous, and resumption entry points for the
 * LangGraph ReAct agent, plus conversation/session management methods.
 *
 * Dependency injection uses config.configurable (no globalThis).
 * The graph is built once and cached for the process lifetime.
 */
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { SkillManifest } from '../agent-runtime/types.js';
import { buildAgentGraph } from './graph.js';
import { createAllTools } from './tools.js';
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
import { Command } from '@langchain/langgraph';
import { logger } from '../utils/logger.js';
import type { AgentConfigurable } from './configurable.js';

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
  conversationId: string;
  traceId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  response: string;
  mode: 'conversation' | 'execution';
  toolCalls: unknown[];
  model?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  report?: Record<string, unknown>;
  draftState?: Record<string, unknown>;
  presentation?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let singleton: LangGraphAgentService | undefined;

export function getAgentService(): LangGraphAgentService {
  if (!singleton) {
    singleton = new LangGraphAgentService(new AgentSkillRuntime());
  }
  return singleton;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class LangGraphAgentService {
  private readonly skillRuntime: AgentSkillRuntime;
  private readonly checkpointer: FileCheckpointer;
  private readonly workspaceRoot: string;

  // Execution clients (created once, injected via config.configurable)
  private readonly engineClient: ReturnType<typeof createLocalAnalysisEngineClient>;
  private readonly codeCheckClient: ReturnType<typeof createLocalCodeCheckClient>;
  private readonly structureProtocolClient: ReturnType<typeof createLocalStructureProtocolClient>;

  // Cached graph — built once, reused across requests
  private graphPromise: Promise<ReturnType<typeof buildAgentGraph>> | undefined;

  constructor(skillRuntime: AgentSkillRuntime) {
    this.skillRuntime = skillRuntime;
    this.checkpointer = new FileCheckpointer(getCheckpointerDataDir());
    this.workspaceRoot = getWorkspaceRoot();

    // Create execution clients once (lifetime of the process)
    this.engineClient = createLocalAnalysisEngineClient();
    this.codeCheckClient = createLocalCodeCheckClient();
    this.structureProtocolClient = createLocalStructureProtocolClient();
  }

  // ---------------------------------------------------------------------------
  // Configurable builder (DI container for tools/nodes)
  // ---------------------------------------------------------------------------

  private buildConfigurable(): AgentConfigurable {
    return {
      skillRuntime: this.skillRuntime,
      engineClient: this.engineClient,
      codeCheckClient: this.codeCheckClient,
      structureProtocolClient: this.structureProtocolClient,
      workspaceRoot: this.workspaceRoot,
    };
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
  // Graph construction (cached)
  // ---------------------------------------------------------------------------

  /** Get or build the compiled graph. Thread-safe for concurrent first calls. */
  private async getGraph(): Promise<ReturnType<typeof buildAgentGraph>> {
    if (!this.graphPromise) {
      this.graphPromise = (async () => {
        const skillManifests = await this.skillRuntime.listSkillManifests();
        return buildAgentGraph({
          skillRuntime: this.skillRuntime,
          skillManifests,
          checkpointer: this.checkpointer,
        });
      })();
    }
    return this.graphPromise;
  }

  /** Force rebuild the graph (e.g. after skill install/uninstall). */
  resetGraph(): void {
    this.graphPromise = undefined;
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

    const graph = await this.getGraph();

    const config = {
      configurable: {
        thread_id: conversationId,
        ...this.buildConfigurable(),
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

    const graph = await this.getGraph();

    const config = {
      configurable: {
        thread_id: conversationId,
        ...this.buildConfigurable(),
      },
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

    const graph = await this.getGraph();

    const config = {
      configurable: {
        thread_id: conversationId,
        ...this.buildConfigurable(),
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

    return this.extractResult(result, conversationId, traceId, startedAt);
  }

  /**
   * Run the agent and return the full final AgentState (not just the summary).
   * Used by benchmark tooling that needs access to model, analysisResult, report etc.
   */
  async runFull(input: LangGraphRunInput): Promise<AgentState> {
    const locale = input.context?.locale || 'zh';
    const conversationId = input.conversationId || `bench-${randomUUID()}`;
    const graph = await this.getGraph();
    const config = {
      configurable: {
        thread_id: conversationId,
        ...this.buildConfigurable(),
      },
    };

    return await graph.invoke(
      {
        messages: [new HumanMessage(input.message)],
        locale,
        workspaceRoot: this.workspaceRoot,
        selectedSkillIds: input.context?.skillIds || [],
        lastUserMessage: input.message,
        policy: {
          analysisType: input.context?.analysisType,
          designCode: input.context?.designCode,
        },
      },
      config,
    ) as AgentState;
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  async getConversationSessionSnapshot(
    conversationId: string,
    _locale: AppLocale,
  ): Promise<{ snapshot: Record<string, unknown>; state?: AgentState } | undefined> {
    try {
      const graph = await this.getGraph();
      const config = { configurable: { thread_id: conversationId } };
      const stateSnapshot = await graph.getState(config);
      const state = stateSnapshot.values as AgentState;

      return {
        snapshot: {
          draft: state.draftState || null,
          interaction: {
            state: 'ready',
            stage: 'model',
            turnId: conversationId,
          },
          model: undefined,
          updatedAt: new Date().toISOString(),
        },
        state,
      };
    } catch (error) {
      logger.debug({ conversationId, error }, 'Failed to load session snapshot');
      return undefined;
    }
  }

  async clearConversationSession(conversationId: string): Promise<void> {
    await this.checkpointer.deleteThread(conversationId);
  }

  async listSkills(): Promise<{ skills: SkillManifest[] }> {
    const manifests = await this.skillRuntime.listSkillManifests();
    return { skills: manifests };
  }

  /**
   * Get the agent protocol (tool schemas) as a static method.
   * Dynamically reads from createAllTools() so it stays in sync.
   * No skillRuntime needed — only returns name + description metadata.
   */
  static getProtocol(): { tools: Array<{ name: string; description: string }> } {
    // createAllTools captures skillRuntime in closures but doesn't call it at
    // creation time, so passing undefined is safe for metadata-only access.
    const tools = createAllTools({ skillRuntime: undefined as any });
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
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
