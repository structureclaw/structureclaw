/**
 * API Contract Types for Agent Operations
 *
 * These types define the request/response shapes for the three agent endpoints:
 * - chat-message: Simple chat interaction
 * - chat-execute: Chat with execution mode
 * - agent-run: Full agent execution with analysis and reporting options
 */

// Enum-like types for form options
export type AnalysisType = 'none' | 'structural' | 'code' | 'comprehensive'
export type ReportFormat = 'markdown' | 'html' | 'json'
export type ReportOutput = 'inline' | 'file' | 'both'
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Context payload shared across request types
 */
export interface ContextPayload {
  /** Optional model JSON text to include in request */
  modelText?: string
  /** Whether to include the model in the context */
  includeModel?: boolean
  /** Optional structured model object */
  model?: Record<string, unknown>
  /** Optional explicit user decision for interaction flow */
  userDecision?: 'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise'
  /** Optional parameter values provided in this turn */
  providedValues?: Record<string, unknown>
}

/**
 * Request payload for chat-message endpoint
 * Simple chat interaction without execution
 */
export interface ChatMessageRequest {
  /** The user's message text */
  message: string
  /** Optional conversation ID for continuity */
  conversationId?: string | null
  /** Optional trace ID for request tracking */
  traceId?: string | null
  /** Optional context payload */
  context?: ContextPayload
}

/**
 * Request payload for chat-execute endpoint
 * Chat with execution mode (mode is required)
 */
export interface ChatExecuteRequest {
  /** The user's message text */
  message: string
  /** Execution mode: chat, execute, or auto */
  mode: 'chat' | 'execute' | 'auto'
  /** Optional conversation ID for continuity */
  conversationId?: string | null
  /** Optional trace ID for request tracking */
  traceId?: string | null
  /** Optional context payload */
  context?: ContextPayload
}

/**
 * Request payload for agent-run endpoint
 * Full agent execution with analysis and reporting options
 */
export interface AgentRunRequest {
  /** The user's message text */
  message: string
  /** Execution mode: chat, execute, or auto */
  mode: 'chat' | 'execute' | 'auto'
  /** Optional conversation ID for continuity */
  conversationId?: string | null
  /** Optional trace ID for request tracking */
  traceId?: string | null
  /** Optional context payload */
  context?: ContextPayload
  /** Type of analysis to perform */
  analysisType?: AnalysisType
  /** Format for report output */
  reportFormat?: ReportFormat
  /** Where to output the report */
  reportOutput?: ReportOutput
  /** Whether to auto-analyze results */
  autoAnalyze?: boolean
  /** Whether to perform automatic code checking */
  autoCodeCheck?: boolean
  /** Whether to include a report in the response */
  includeReport?: boolean
}

/**
 * Artifact from agent execution
 */
export interface Artifact {
  /** Format of the artifact */
  format: string
  /** Path to the artifact */
  path: string
}

/**
 * Agent metrics from execution
 */
export interface AgentMetrics {
  /** Number of tool calls made */
  toolCount?: number
  /** Number of failed tool calls */
  failedToolCount?: number
  /** Total duration of all tool calls in milliseconds */
  totalToolDurationMs?: number
  /** Average duration per tool call in milliseconds */
  averageToolDurationMs?: number
  /** Maximum duration of a single tool call in milliseconds */
  maxToolDurationMs?: number
  /** Duration by tool name */
  toolDurationMsByName?: Record<string, number>
}

/**
 * Agent tool call result
 */
export interface AgentToolCall {
  /** Tool name */
  name?: string
  /** Tool identifier (alternative to name) */
  tool?: string
  /** Status of the tool call */
  status: 'success' | 'error'
  /** Duration of the call in milliseconds */
  durationMs?: number
  /** Error code if failed */
  errorCode?: string
  /** Error message if failed */
  error?: string
  /** Tool arguments */
  arguments?: Record<string, unknown>
  /** Optional result from tool execution */
  result?: unknown
}

/**
 * Clarification request from agent
 */
export interface Clarification {
  /** Question text */
  question?: string
  /** Missing fields that need to be provided */
  missingFields?: string[]
  /** Clarification ID */
  id?: string
  /** Optional options for the user to choose from */
  options?: string[]
}

export interface InteractionQuestion {
  paramKey: string
  label: string
  question: string
  unit?: string
  required: boolean
  critical: boolean
  suggestedValue?: unknown
}

export interface AgentInteraction {
  state: 'collecting' | 'confirming' | 'ready' | 'executing' | 'completed' | 'blocked'
  stage: 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report'
  turnId: string
  questions?: InteractionQuestion[]
  pending?: {
    criticalMissing?: string[]
    nonCriticalMissing?: string[]
  }
  proposedDefaults?: Array<{
    paramKey: string
    value: unknown
    reason: string
  }>
  nextActions?: Array<'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise'>
}

/**
 * Report from agent execution
 */
export interface AgentReport {
  /** Summary text */
  summary?: string
  /** Markdown content */
  markdown?: string
}

/**
 * Agent execution result
 */
export interface AgentResult {
  /** The agent's response text */
  response?: string
  /** Conversation ID for continuity */
  conversationId?: string
  /** Trace ID for request tracking */
  traceId?: string
  /** Whether the execution was successful */
  success?: boolean
  /** Whether the agent needs model input */
  needsModelInput?: boolean
  /** Execution plan steps */
  plan?: string[]
  /** Tool calls made during execution */
  toolCalls?: AgentToolCall[]
  /** Execution metrics */
  metrics?: AgentMetrics
  /** Clarification request if needed */
  clarification?: Clarification
  /** Rich interaction payload for multi-turn parameter confirmation */
  interaction?: AgentInteraction
  /** Artifacts generated by the agent */
  artifacts?: Artifact[]
  /** Report generated by the agent */
  report?: AgentReport
  /** Started at timestamp */
  startedAt?: string
  /** Completed at timestamp */
  completedAt?: string
  /** Total duration in milliseconds */
  durationMs?: number
  /** Optional structured data from the agent */
  data?: Record<string, unknown>
}

/**
 * Agent error response
 */
export interface AgentError {
  /** Error message */
  message: string
  /** Optional error code */
  code?: string
  /** Optional additional details */
  details?: Record<string, unknown>
}

/**
 * Stream frame types for SSE responses
 */
export type StreamFrameType = 'text' | 'tool_call' | 'clarification' | 'complete' | 'error'

/**
 * Stream frame for SSE responses
 */
export interface StreamFrame {
  /** Type of stream frame */
  type: StreamFrameType
  /** Content of the frame */
  content: string | Record<string, unknown>
  /** Optional timestamp */
  timestamp?: string
}
