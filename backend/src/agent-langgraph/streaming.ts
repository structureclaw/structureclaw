/**
 * Streaming adapter: converts LangGraph stream events into the existing
 * AgentStreamChunk format used by the Fastify SSE endpoint.
 *
 * LangGraph emits events with streamMode:
 *   - "messages": token-level content from the LLM (AIMessageChunk)
 *   - "custom": arbitrary data written via config.writer (tool progress)
 *   - "updates": state change notifications
 *
 * We map these to the existing chunk types:
 *   - start, presentation_init, phase_upsert, step_upsert, artifact_upsert,
 *     summary_replace, result, presentation_complete, done, error
 */
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import { isCommand } from '@langchain/langgraph';
import {
  createEmptyAssistantPresentation,
  type AssistantPresentation,
} from '../services/chat-presentation.js';
import { logger } from '../utils/logger.js';
import { createAgentLogger } from '../utils/agent-logger.js';

// Re-export the stream chunk type for convenience
export type { AgentStreamChunk } from '../types/agent-stream.js';
import type { AgentStreamChunk } from '../types/agent-stream.js';

// ---------------------------------------------------------------------------
// Stream context passed from agent-service to streaming layer
// ---------------------------------------------------------------------------

export interface StreamContext {
  conversationId: string;
  traceId: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Event classification helpers
// ---------------------------------------------------------------------------

function isAIMessageChunk(msg: unknown): msg is AIMessageChunk {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    '_getType' in msg &&
    typeof (msg as any)._getType === 'function' &&
    (msg as any)._getType() === 'ai'
  );
}

function hasToolCalls(msg: BaseMessage): boolean {
  return (
    'tool_calls' in msg &&
    Array.isArray((msg as any).tool_calls) &&
    (msg as any).tool_calls.length > 0
  );
}

/**
 * Extract plain text from message content which may be a string
 * or an array of content blocks like [{type:"text", text:"..."}].
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } =>
        typeof block === 'object' && block !== null && 'text' in block,
      )
      .map((block) => block.text)
      .join('');
  }
  return '';
}

/**
 * Extract skillId from tool output JSON content.
 * Many tools (detect_structure_type, run_analysis, etc.) include
 * { skillId: "..." } in their output JSON.
 */
function extractSkillIdFromContent(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed?.skillId === 'string' ? parsed.skillId : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Stream adapter
// ---------------------------------------------------------------------------

/**
 * Convert a LangGraph stream event into zero or more AgentStreamChunk events.
 *
 * @param event - The raw event from LangGraph's .stream() iterator
 * @param eventMode - Which streamMode produced this event
 */
export function langGraphEventToChunks(
  event: unknown,
  eventMode: string,
): AgentStreamChunk[] {
  const chunks: AgentStreamChunk[] = [];

  // Handle token-level LLM output from "messages" stream mode
  if (eventMode === 'messages') {
    // LangGraph messages mode yields [message, metadata] or just the message
    const msg = Array.isArray(event) ? event[0] : event;
    if (isAIMessageChunk(msg) && !hasToolCalls(msg as any)) {
      const content = extractTextContent(msg.content);
      if (content.length > 0) {
        chunks.push({ type: 'token', content });
      }
    }
    return chunks;
  }

  if (eventMode === 'custom') {
    // Custom events from config.writer in tools — pass through directly
    if (typeof event === 'object' && event !== null && 'type' in event) {
      chunks.push(event as AgentStreamChunk);
    } else if (typeof event === 'string') {
      chunks.push({ type: 'summary_replace', summaryText: event });
    }
    return chunks;
  }

  if (eventMode === 'updates') {
    const update = event as Record<string, any>;

    // Handle interrupt events
    if (update.__interrupt__) {
      const interrupts = Array.isArray(update.__interrupt__)
        ? update.__interrupt__
        : [update.__interrupt__];
      for (const interrupt of interrupts) {
        const value = interrupt.value || interrupt;
        chunks.push({
          type: 'interaction_update',
          content: {
            questions: [
              {
                question: value?.question || 'Please provide additional information',
                label: value?.question || 'Clarification needed',
              },
            ],
            conversationStage: 'awaiting_user_input',
            pending: { criticalMissing: [] },
            resumeRequired: true,
            options: value?.options || [],
          },
        });
      }
      return chunks;
    }

    // Process node state updates
    for (const [nodeName, nodeState] of Object.entries(update)) {
      if (nodeName === 'agent' && nodeState?.messages) {
        const messages: BaseMessage[] = Array.isArray(nodeState.messages)
          ? nodeState.messages
          : [nodeState.messages];

        for (const msg of messages) {
          // Use duck-typing — when streamMode includes 'messages',
          // LangGraph's StreamMessagesHandler may return AIMessageChunk
          const isAI = msg != null && typeof msg === 'object' && typeof (msg as any)._getType === 'function' && (msg as any)._getType() === 'ai';
          if (isAI) {
            if (hasToolCalls(msg)) {
              for (const tc of (msg as any).tool_calls) {
                const phase = mapToolToPhase(tc.name);
                chunks.push({
                  type: 'step_upsert',
                  phaseId: `phase-${phase}`,
                  step: {
                    id: `step-${tc.id || randomUUID()}`,
                    phase,
                    status: 'running',
                    tool: tc.name,
                    title: tc.name,
                    args: tc.args ?? undefined,
                    startedAt: new Date().toISOString(),
                  },
                });
              }
            } else if (typeof msg.content === 'string' && msg.content.length > 0) {
              chunks.push({
                type: 'result',
                content: { response: msg.content, mode: 'conversation' },
              });
            } else {
              // Handle array content blocks (e.g. [{type:"text", text:"..."}])
              const text = extractTextContent(msg.content);
              if (text.length > 0) {
                chunks.push({
                  type: 'result',
                  content: { response: text, mode: 'conversation' },
                });
              }
            }
          }
        }
      }

      if (nodeName === 'tools') {
        // ToolNode now returns Command objects mixed with { messages: [...] }.
        // With Command-based tools, the "tools" update may contain:
        //   - Command objects (with state updates)
        //   - { messages: [ToolMessage] } objects
        // We extract ToolMessages from both patterns.
        const toolMessages = extractToolMessages(nodeState);
        for (const msg of toolMessages) {
          const toolName = (msg as any).name || 'tool_execution';
          const toolCallId = (msg as any).tool_call_id || (msg as any).id;
          const phase = mapToolToPhase(toolName);
          const content = typeof msg.content === 'string' ? msg.content : '';

          chunks.push({
            type: 'step_upsert',
            phaseId: `phase-${phase}`,
            step: {
              id: toolCallId ? `step-${toolCallId}` : `step-tool-${randomUUID()}`,
              phase,
              status: 'done',
              tool: toolName,
              title: toolName,
              skillId: extractSkillIdFromContent(content),
              completedAt: new Date().toISOString(),
              output: truncate(content, 500),
            },
          });

          // Emit artifact_payload_sync for tool outputs containing model/analysis/report
          if (content) {
            chunks.push(...emitArtifactSync(content, nodeState));
          }
        }
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Tool message extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract ToolMessages from ToolNode output.
 *
 * ToolNode may return several patterns depending on whether tools return
 * Commands or plain strings:
 *   1. Resolved state update: { messages: [ToolMessage, ...], model?: ... }
 *      — LangGraph processes Commands and emits the merged state
 *   2. Mixed array: [Command, { messages: [ToolMessage] }, ...]
 *      — raw ToolNode output before graph processing
 *   3. Simple pattern: { messages: [ToolMessage, ...] }
 *      — when no tools return Commands
 */
function extractToolMessages(nodeState: any): any[] {
  if (!nodeState) return [];

  const isToolMessage = (m: any) =>
    m && typeof m === 'object' && typeof m._getType === 'function' && m._getType() === 'tool';

  // Pattern 1 & 3: object with .messages (resolved or simple)
  if (!Array.isArray(nodeState) && nodeState.messages) {
    const messages: any[] = Array.isArray(nodeState.messages)
      ? nodeState.messages
      : [nodeState.messages];
    return messages.filter(isToolMessage);
  }

  // Pattern 2: mixed array of Command objects and { messages: [...] } objects
  if (Array.isArray(nodeState)) {
    const messages: any[] = [];
    for (const item of nodeState) {
      if (!item || typeof item !== 'object') continue;

      if (isCommand(item)) {
        // Command.update.messages contains the ToolMessage
        const update = (item as any).update;
        if (update && update.messages && Array.isArray(update.messages)) {
          messages.push(...update.messages.filter(isToolMessage));
        }
      } else if ('messages' in item && Array.isArray(item.messages)) {
        messages.push(...item.messages.filter(isToolMessage));
      }
    }
    return messages;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Artifact sync helper
// ---------------------------------------------------------------------------

/**
 * Resolve a state value from nodeState, handling all output patterns:
 *  - Resolved state: { messages, model, ... }
 *  - Command array: [Command({ update: { model, messages } })]
 *  - Single Command: Command({ update: { model, messages } })
 */
function resolveStateValue(nodeState: unknown, key: string): unknown {
  if (!nodeState || typeof nodeState !== 'object') return undefined;

  // Pattern A: plain object with key directly (resolved state)
  if (!Array.isArray(nodeState) && key in (nodeState as Record<string, unknown>)) {
    return (nodeState as Record<string, unknown>)[key];
  }

  // Pattern B: array of items (Commands or state objects)
  if (Array.isArray(nodeState)) {
    for (const item of nodeState) {
      if (!item || typeof item !== 'object') continue;
      if (isCommand(item)) {
        const update = (item as any).update;
        if (update && typeof update === 'object' && key in update) {
          return update[key];
        }
      }
      if (key in (item as Record<string, unknown>)) {
        return (item as Record<string, unknown>)[key];
      }
    }
    return undefined;
  }

  // Pattern C: single Command
  if (isCommand(nodeState)) {
    const update = (nodeState as any).update;
    if (update && typeof update === 'object' && key in update) {
      return update[key];
    }
  }

  return undefined;
}

function emitArtifactSync(toolOutput: string, nodeState?: any): AgentStreamChunk[] {
  const chunks: AgentStreamChunk[] = [];
  try {
    const parsed = JSON.parse(toolOutput);
    if (parsed && typeof parsed === 'object' && parsed.success) {
      const model = resolveStateValue(nodeState, 'model');
      const analysisResult = resolveStateValue(nodeState, 'analysisResult');
      const report = resolveStateValue(nodeState, 'report');

      if (model) {
        chunks.push({
          type: 'artifact_payload_sync',
          artifact: 'model',
          model: model as Record<string, unknown>,
        });
      }
      if (analysisResult) {
        chunks.push({
          type: 'artifact_payload_sync',
          artifact: 'analysis',
          latestResult: { analysis: analysisResult as Record<string, unknown> },
        });
      }
      if (report) {
        chunks.push({
          type: 'artifact_payload_sync',
          artifact: 'report',
          latestResult: { report: report as Record<string, unknown> },
        });
      }
    }
  } catch {
    // Not JSON — skip artifact sync
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Phase mapping
// ---------------------------------------------------------------------------

function mapToolToPhase(toolName: string): 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report' {
  if (toolName.includes('detect') || toolName.includes('extract') || toolName.includes('clarification')) {
    return 'understanding';
  }
  if (toolName.includes('draft') || toolName.includes('build_model') || toolName.includes('model')) {
    return 'modeling';
  }
  if (toolName.includes('validate')) {
    return 'validation';
  }
  if (toolName.includes('analysis') || toolName.includes('code_check')) {
    return 'analysis';
  }
  if (toolName.includes('report')) {
    return 'report';
  }
  return 'understanding';
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

// ---------------------------------------------------------------------------
// High-level streaming wrapper
// ---------------------------------------------------------------------------

/**
 * Stream events from a LangGraph graph invocation and convert them to
 * AgentStreamChunk events for the SSE endpoint.
 */
export async function* streamGraphToChunks(
  graphStream: AsyncIterable<unknown>,
  streamModes: string[],
  ctx: StreamContext,
): AsyncGenerator<AgentStreamChunk> {
  // Emit start event with conversation context (frontend reads conversationId from here)
  yield { type: 'start', content: { conversationId: ctx.conversationId, traceId: ctx.traceId, startedAt: ctx.startedAt } };

  // Emit presentation init (frontend expects this to set up the timeline)
  const presentation: AssistantPresentation = createEmptyAssistantPresentation({
    traceId: ctx.traceId,
    mode: 'execution',
    startedAt: ctx.startedAt,
  });
  yield { type: 'presentation_init', presentation };

  let interrupted = false;
  let tokenBuffer = '';
  let totalChunks = 0;
  const streamStart = Date.now();
  const streamLog = createAgentLogger(ctx.traceId, ctx.conversationId);
  streamLog.debug({ streamModes }, 'stream processing started');

  // Track accumulated artifacts from artifact_payload_sync events so
  // the final result event can include model/analysis/report data for
  // the frontend to build VisualizationSnapshots.
  let accumulatedModel: Record<string, unknown> | undefined;
  let accumulatedAnalysis: Record<string, unknown> | undefined;
  let accumulatedReport: Record<string, unknown> | undefined;

  function processChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === 'interaction_update') {
      interrupted = true;
      return;
    }

    // Mirror token text into presentation.summaryText so the
    // timeline view shows the LLM's streaming output in real time.
    if (chunk.type === 'token' && 'content' in chunk) {
      tokenBuffer += (chunk as { content: string }).content;
    }

    // Reset tokenBuffer when a tool starts so the next text bubble
    // only contains tokens generated after the tool call.
    if (chunk.type === 'step_upsert') {
      const step = (chunk as { step: { status: string } }).step;
      if (step.status === 'running') {
        tokenBuffer = '';
      }
    }

    // Track artifact data for result event enrichment
    if (chunk.type === 'artifact_payload_sync') {
      const sync = chunk as { artifact?: string; model?: Record<string, unknown>; latestResult?: Record<string, unknown> };
      if (sync.artifact === 'model' && sync.model) {
        accumulatedModel = sync.model;
      }
      if (sync.artifact === 'analysis' && sync.latestResult?.analysis) {
        accumulatedAnalysis = sync.latestResult.analysis as Record<string, unknown>;
      }
      if (sync.artifact === 'report' && sync.latestResult?.report) {
        accumulatedReport = sync.latestResult.report as Record<string, unknown>;
      }
    }
  }

  try {
    for await (const event of graphStream) {
      // LangGraph stream with multiple modes yields [mode, data] tuples
      let chunks: AgentStreamChunk[];
      if (Array.isArray(event) && event.length === 2) {
        const [mode, data] = event;
        chunks = langGraphEventToChunks(data, String(mode));
      } else {
        const mode = streamModes.length === 1 ? streamModes[0] : 'updates';
        chunks = langGraphEventToChunks(event, mode);
      }

      for (const chunk of chunks) {
        totalChunks += 1;
        processChunk(chunk);

        // Enrich the final result event with accumulated artifact data
        // so the frontend can build VisualizationSnapshots.
        if (chunk.type === 'result' && chunk.content && typeof chunk.content === 'object') {
          const enriched = { ...(chunk.content as Record<string, unknown>) };
          if (accumulatedModel) enriched.model = accumulatedModel;
          if (accumulatedAnalysis) enriched.analysis = accumulatedAnalysis;
          if (accumulatedReport) enriched.report = accumulatedReport;
          enriched.completedAt = new Date().toISOString();
          yield { ...chunk, content: enriched } as AgentStreamChunk;
          continue;
        }

        yield chunk;
      }

      // Yield a single summary_replace after processing all chunks from this event
      if (chunks.some(c => c.type === 'token')) {
        yield { type: 'summary_replace', summaryText: tokenBuffer };
      }
    }

    // Only emit completion events when the graph finished normally.
    // On interrupt (human-in-the-loop), the frontend should show the
    // interaction UI and wait for the user to respond via /stream/resume.
    if (!interrupted) {
      streamLog.debug({ totalChunks, durationMs: Date.now() - streamStart, interrupted: false }, 'stream processing completed');
      yield { type: 'presentation_complete', completedAt: new Date().toISOString() };
      yield { type: 'done' };
    } else {
      streamLog.debug({ totalChunks, durationMs: Date.now() - streamStart, interrupted: true }, 'stream processing interrupted (human-in-the-loop)');
    }
  } catch (error) {
    streamLog.error({ error, totalChunks, durationMs: Date.now() - streamStart }, 'LangGraph stream error');
    yield { type: 'presentation_error', phase: 'modeling' as const, message: error instanceof Error ? error.message : String(error) };
    yield { type: 'error', error: String(error) };
  }
}
