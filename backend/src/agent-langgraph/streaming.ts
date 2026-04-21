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
import type { AIMessage, AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import {
  createEmptyAssistantPresentation,
  type AssistantPresentation,
} from '../services/chat-presentation.js';
import { logger } from '../utils/logger.js';

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

function isAIMessage(msg: unknown): msg is AIMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    '_getType' in msg &&
    typeof (msg as any)._getType === 'function' &&
    (msg as any)._getType() === 'ai'
  );
}

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
      const content = typeof msg.content === 'string' ? msg.content : '';
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
          if (isAIMessage(msg)) {
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
                    startedAt: new Date().toISOString(),
                  },
                });
              }
            } else if (typeof msg.content === 'string' && msg.content.length > 0) {
              chunks.push({
                type: 'result',
                content: { summary: msg.content, mode: 'conversation' },
              });
            }
          }
        }
      }

      if (nodeName === 'tools') {
        const messages: BaseMessage[] = Array.isArray(nodeState?.messages)
          ? nodeState.messages
          : nodeState?.messages ? [nodeState.messages] : [];

        for (const msg of messages) {
          chunks.push({
            type: 'step_upsert',
            phaseId: `phase-analysis`,
            step: {
              id: `step-tool-${randomUUID()}`,
              phase: 'analysis',
              status: 'done',
              tool: 'tool_execution',
              title: 'Tool completed',
              completedAt: new Date().toISOString(),
              output: typeof msg.content === 'string' ? truncate(msg.content, 500) : msg.content,
            },
          });

          // Emit artifact_payload_sync for tool outputs containing model/analysis/report
          if (typeof msg.content === 'string') {
            chunks.push(...emitArtifactSync(msg.content));
          }
        }
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Artifact sync helper
// ---------------------------------------------------------------------------

function emitArtifactSync(toolOutput: string): AgentStreamChunk[] {
  const chunks: AgentStreamChunk[] = [];
  try {
    const parsed = JSON.parse(toolOutput);
    if (parsed && typeof parsed === 'object') {
      if (parsed.success && parsed.model) {
        chunks.push({
          type: 'artifact_payload_sync',
          artifact: 'model',
          model: parsed.model,
        });
      }
      if (parsed.success && (parsed.result || parsed.analysis)) {
        chunks.push({
          type: 'artifact_payload_sync',
          artifact: 'analysis',
          latestResult: { analysis: parsed.result || parsed },
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

  try {
    for await (const event of graphStream) {
      // LangGraph stream with multiple modes yields [mode, data] tuples
      if (Array.isArray(event) && event.length === 2) {
        const [mode, data] = event;
        const modeStr = String(mode);
        const chunks = langGraphEventToChunks(data, modeStr);
        for (const chunk of chunks) {
          yield chunk;
        }
      } else {
        const mode = streamModes.length === 1 ? streamModes[0] : 'updates';
        const chunks = langGraphEventToChunks(event, mode);
        for (const chunk of chunks) {
          yield chunk;
        }
      }
    }

    // Emit presentation complete before done
    yield { type: 'presentation_complete', completedAt: new Date().toISOString() };
    yield { type: 'done' };
  } catch (error) {
    logger.error({ error }, 'LangGraph stream error');
    yield { type: 'presentation_error', phase: 'modeling' as const, message: error instanceof Error ? error.message : String(error) };
    yield { type: 'error', error: String(error) };
  }
}
