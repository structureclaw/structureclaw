import type { Logger } from 'pino';
import { logger } from './logger.js';

const TRUNCATE_MAX = 2000;

/**
 * Immutable truncate: returns a new string capped at maxLen chars + "…[truncated]".
 * Returns the original reference unchanged when short enough.
 */
export function truncate(value: string, maxLen: number = TRUNCATE_MAX): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…[truncated ${value.length - maxLen} chars]`;
}

/** Create a child logger with traceId + conversationId bound to every log line. */
export function createAgentLogger(traceId: string, conversationId: string): Logger {
  return logger.child({ traceId, conversationId });
}

/** Re-export root logger for callers that don't need a child. */
export { logger };

/**
 * Resolve a logger from AgentConfigurable._logger, or fall back to the root logger.
 * Accepts `undefined` to make call-sites ergonomic when configurable may not exist.
 */
export function getLogger(configurable: Record<string, unknown> | undefined): Logger {
  const child = configurable?._logger;
  return child && typeof child === 'object' && 'info' in child
    ? (child as Logger)
    : logger;
}

// ---------------------------------------------------------------------------
// Structured log helpers — each respects the pino level hierarchy
// ---------------------------------------------------------------------------

export interface ToolCallParams {
  tool: string;
  input?: unknown;
  output?: unknown;
  durationMs: number;
  extra?: Record<string, unknown>;
  level?: 'info' | 'debug' | 'trace';
}

/**
 * Log a tool call.
 * - info (default): tool name + duration
 * - debug:          + truncated input/output
 * - trace:          + full input/output (no truncation)
 */
export function logToolCall(log: Logger, params: ToolCallParams): void {
  const { tool, durationMs, extra, level = 'info' } = params;

  const base: Record<string, unknown> = {
    tool,
    durationMs,
    ...extra,
  };

  if (level === 'info') {
    log.info(base, `tool:${tool} completed`);
    return;
  }

  const inputStr = stringify(params.input);
  const outputStr = stringify(params.output);

  if (level === 'debug') {
    base.input = truncate(inputStr);
    base.output = truncate(outputStr);
    log.debug(base, `tool:${tool} completed (debug)`);
    return;
  }

  // trace — full I/O
  base.input = inputStr;
  base.output = outputStr;
  log.trace(base, `tool:${tool} completed (trace)`);
}

export interface LlmCallParams {
  model: string;
  /** prompt token count, if available */
  promptTokens?: number;
  /** completion token count, if available */
  completionTokens?: number;
  durationMs: number;
  request?: unknown;
  response?: unknown;
  extra?: Record<string, unknown>;
  level?: 'info' | 'debug' | 'trace';
}

/**
 * Log an LLM call.
 * - info (default): model + token counts + latency
 * - debug:          + truncated request/response
 * - trace:          + full request/response
 */
export function logLlmCall(log: Logger, params: LlmCallParams): void {
  const { model, promptTokens, completionTokens, durationMs, extra, level = 'info' } = params;

  const base: Record<string, unknown> = {
    model,
    durationMs,
    ...extra,
  };
  if (promptTokens !== undefined) base.promptTokens = promptTokens;
  if (completionTokens !== undefined) base.completionTokens = completionTokens;

  if (level === 'info') {
    log.info(base, `llm:${model} call completed`);
    return;
  }

  const reqStr = stringify(params.request);
  const resStr = stringify(params.response);

  if (level === 'debug') {
    base.request = truncate(reqStr);
    base.response = truncate(resStr);
    log.debug(base, `llm:${model} call completed (debug)`);
    return;
  }

  base.request = reqStr;
  base.response = resStr;
  log.trace(base, `llm:${model} call completed (trace)`);
}

export interface StateTransitionParams {
  node: string;
  channelsChanged?: string[];
  channelValues?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  level?: 'debug' | 'trace';
}

/**
 * Log a state transition between graph nodes.
 * - debug (default): node name + channel names
 * - trace:           + truncated channel values
 */
export function logStateTransition(log: Logger, params: StateTransitionParams): void {
  const { node, channelsChanged, channelValues, extra, level = 'debug' } = params;

  const base: Record<string, unknown> = {
    node,
    channelsChanged,
    ...extra,
  };

  if (level === 'debug') {
    log.debug(base, `state transition: ${node}`);
    return;
  }

  // trace — include truncated channel values
  if (channelValues) {
    const truncated: Record<string, string> = {};
    for (const [key, val] of Object.entries(channelValues)) {
      truncated[key] = truncate(stringify(val));
    }
    base.channelValues = truncated;
  }
  log.trace(base, `state transition: ${node}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
