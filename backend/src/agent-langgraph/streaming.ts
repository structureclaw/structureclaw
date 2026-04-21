/**
 * Streaming adapter: converts LangGraph stream events into the existing
 * AgentStreamChunk format used by the Fastify SSE endpoint.
 *
 * LangGraph emits events with streamMode:
 *   - "messages": token-level content from the LLM
 *   - "custom": arbitrary data written via config.writer (tool progress)
 *   - "updates": state change notifications
 *
 * We map these to the existing chunk types:
 *   - start, presentation_init, phase_upsert, step_upsert, artifact_upsert,
 *     summary_replace, result, presentation_complete, done, error
 */
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { logger } from '../utils/logger.js';

// Re-export the existing stream chunk type for convenience
export type { AgentStreamChunk } from '../services/agent.js';
import type { AgentStreamChunk } from '../services/agent.js';

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

  // Handle interrupt events — LangGraph emits these when interrupt() is called
  if (eventMode === 'updates') {
    const update = event as Record<string, any>;
    // Check for __interrupt__ in the update (could be at top level or nested)
    if (update.__interrupt__) {
      const interrupts = Array.isArray(update.__interrupt__)
        ? update.__interrupt__
        : [update.__interrupt__];
      for (const interrupt of interrupts) {
        const value = interrupt.value || interrupt;
        chunks.push({
          type: 'interaction_update',
          content: {
            interactionType: 'clarification',
            question: value?.question || 'Please provide additional information',
            options: value?.options || [],
            resumeRequired: true,
          },
        });
      }
      return chunks;
    }
  }

  if (eventMode === 'updates') {
    // State update: extract the node name and any messages
    const update = event as Record<string, any>;
    for (const [nodeName, nodeState] of Object.entries(update)) {
      if (nodeName === 'agent' && nodeState?.messages) {
        const messages: BaseMessage[] = Array.isArray(nodeState.messages)
          ? nodeState.messages
          : [nodeState.messages];

        for (const msg of messages) {
          if (isAIMessage(msg)) {
            if (hasToolCalls(msg)) {
              // Agent decided to call tools — emit step events
              for (const tc of (msg as any).tool_calls) {
                chunks.push({
                  type: 'step_upsert',
                  phaseId: `phase-${tc.name}`,
                  step: {
                    id: `step-${tc.id || Date.now()}`,
                    phase: mapToolToPhase(tc.name),
                    status: 'running',
                    tool: tc.name,
                    title: tc.name,
                    startedAt: new Date().toISOString(),
                  },
                });
              }
            } else if (typeof msg.content === 'string' && msg.content.length > 0) {
              // Final response from agent
              chunks.push({
                type: 'result',
                content: {
                  summary: msg.content,
                  mode: 'conversation',
                },
              });
            }
          }
        }
      }

      if (nodeName === 'tools') {
        // Tool execution completed
        const messages: BaseMessage[] = Array.isArray(nodeState?.messages)
          ? nodeState.messages
          : nodeState?.messages ? [nodeState.messages] : [];

        for (const msg of messages) {
          chunks.push({
            type: 'step_upsert',
            phaseId: `phase-tool`,
            step: {
              id: `step-tool-${Date.now()}`,
              phase: 'analysis',
              status: 'done',
              tool: 'tool_execution',
              title: 'Tool completed',
              completedAt: new Date().toISOString(),
              output: typeof msg.content === 'string' ? truncate(msg.content, 500) : msg.content,
            },
          });
        }
      }
    }
  }

  if (eventMode === 'custom') {
    // Custom events from config.writer in tools — pass through directly
    // These could be progress messages, artifact updates, etc.
    if (typeof event === 'object' && event !== null && 'type' in event) {
      chunks.push(event as AgentStreamChunk);
    } else if (typeof event === 'string') {
      // Plain string progress message
      chunks.push({
        type: 'summary_replace',
        summaryText: event,
      });
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Helpers
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
): AsyncGenerator<AgentStreamChunk> {
  // Emit start event
  yield { type: 'start' };

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
        // Single-mode stream
        const mode = streamModes.length === 1 ? streamModes[0] : 'updates';
        const chunks = langGraphEventToChunks(event, mode);
        for (const chunk of chunks) {
          yield chunk;
        }
      }
    }

    yield { type: 'done' };
  } catch (error) {
    logger.error({ error }, 'LangGraph stream error');
    yield { type: 'error', error: String(error) };
  }
}
