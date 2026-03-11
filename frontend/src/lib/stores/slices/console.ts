import { type StateCreator } from 'zustand'
import type {
  AnalysisType,
  ReportFormat,
  ReportOutput,
  ConnectionState,
  AgentResult,
  AgentError,
  StreamFrame,
} from '@/lib/api/contracts/agent'

// Re-export types for convenience
export type {
  AnalysisType,
  ReportFormat,
  ReportOutput,
  ConnectionState,
  AgentResult,
  AgentError,
  StreamFrame,
}

/**
 * Console endpoint options
 */
export type ConsoleEndpoint = 'agent-run' | 'chat-message' | 'chat-execute'

/**
 * Console mode options
 */
export type ConsoleMode = 'chat' | 'execute' | 'auto'

/**
 * Base console state (endpoint and mode selection)
 */
export interface ConsoleBaseState {
  endpoint: ConsoleEndpoint
  mode: ConsoleMode
  conversationId: string | null
  traceId: string | null
}

/**
 * Form state for console input
 */
export interface ConsoleFormState {
  /** User's message text */
  message: string
  /** Model JSON text input */
  modelText: string
  /** Whether to include model in request */
  includeModel: boolean
  /** Type of analysis to perform */
  analysisType: AnalysisType
  /** Format for report output */
  reportFormat: ReportFormat
  /** Where to output the report */
  reportOutput: ReportOutput
  /** Whether to auto-analyze results */
  autoAnalyze: boolean
  /** Whether to perform automatic code checking */
  autoCodeCheck: boolean
  /** Whether to include a report in the response */
  includeReport: boolean
}

/**
 * Execution state for console operations
 */
export interface ConsoleExecutionState {
  /** Loading state for the current operation */
  loading: boolean
  /** Whether currently streaming SSE data */
  isStreaming: boolean
  /** Current connection state for SSE */
  connectionState: ConnectionState
  /** Result from the last successful execution */
  result: AgentResult | null
  /** Raw response data from the API */
  rawResponse: Record<string, unknown> | null
  /** Stream frames received during SSE */
  streamFrames: StreamFrame[]
  /** Error from the last failed operation */
  error: AgentError | null
}

/**
 * Combined console state
 */
export interface ConsoleState extends ConsoleBaseState, ConsoleFormState, ConsoleExecutionState {}

/**
 * Console actions for state mutations
 */
export interface ConsoleActions {
  // Base actions
  setEndpoint: (endpoint: ConsoleEndpoint) => void
  setMode: (mode: ConsoleMode) => void
  setConversationId: (id: string | null) => void
  setTraceId: (id: string | null) => void
  resetConsole: () => void

  // Form state actions
  setMessage: (message: string) => void
  setModelText: (modelText: string) => void
  setIncludeModel: (includeModel: boolean) => void
  setAnalysisType: (analysisType: AnalysisType) => void
  setReportFormat: (reportFormat: ReportFormat) => void
  setReportOutput: (reportOutput: ReportOutput) => void
  setAutoAnalyze: (autoAnalyze: boolean) => void
  setAutoCodeCheck: (autoCodeCheck: boolean) => void
  setIncludeReport: (includeReport: boolean) => void

  // Execution state actions
  setLoading: (loading: boolean) => void
  setConnectionState: (connectionState: ConnectionState) => void
  setResult: (result: AgentResult | null) => void
  setRawResponse: (rawResponse: Record<string, unknown> | null) => void
  setStreamFrames: (streamFrames: StreamFrame[]) => void
  setError: (error: AgentError | null) => void
}

export type ConsoleSlice = ConsoleState & ConsoleActions

/**
 * Initial state for console base (endpoint, mode, conversation)
 */
export const initialConsoleBaseState: ConsoleBaseState = {
  endpoint: 'chat-message',
  mode: 'auto',
  conversationId: null,
  traceId: null,
}

/**
 * Initial state for console form inputs
 */
export const initialConsoleFormState: ConsoleFormState = {
  message: '',
  modelText: '',
  includeModel: false,
  analysisType: 'static',
  reportFormat: 'markdown',
  reportOutput: 'inline',
  autoAnalyze: false,
  autoCodeCheck: false,
  includeReport: false,
}

/**
 * Initial state for console execution
 */
export const initialConsoleExecutionState: ConsoleExecutionState = {
  loading: false,
  isStreaming: false,
  connectionState: 'disconnected',
  result: null,
  rawResponse: null,
  streamFrames: [],
  error: null,
}

/**
 * Combined initial console state
 */
export const initialConsoleState: ConsoleState = {
  ...initialConsoleBaseState,
  ...initialConsoleFormState,
  ...initialConsoleExecutionState,
}

/**
 * Console slice creator for Zustand store
 * Note: StoreState is defined in context.tsx and will be the full combined state
 * Using 'any' for the state parameter to avoid circular dependency
 * The actual type safety comes from the StoreState in context.tsx
 */
export const createConsoleSlice: StateCreator<ConsoleSlice, [], [], ConsoleSlice> = (set) => ({
  ...initialConsoleState,

  // Base actions
  setEndpoint: (endpoint) => set({ endpoint }),
  setMode: (mode) => set({ mode }),
  setConversationId: (conversationId) => set({ conversationId }),
  setTraceId: (traceId) => set({ traceId }),
  resetConsole: () => set(initialConsoleState),

  // Form state actions
  setMessage: (message) => set({ message }),
  setModelText: (modelText) => set({ modelText }),
  setIncludeModel: (includeModel) => set({ includeModel }),
  setAnalysisType: (analysisType) => set({ analysisType }),
  setReportFormat: (reportFormat) => set({ reportFormat }),
  setReportOutput: (reportOutput) => set({ reportOutput }),
  setAutoAnalyze: (autoAnalyze) => set({ autoAnalyze }),
  setAutoCodeCheck: (autoCodeCheck) => set({ autoCodeCheck }),
  setIncludeReport: (includeReport) => set({ includeReport }),

  // Execution state actions
  setLoading: (loading) => set({ loading }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setResult: (result) => set({ result }),
  setRawResponse: (rawResponse) => set({ rawResponse }),
  setStreamFrames: (streamFrames) => set({ streamFrames }),
  setError: (error) => set({ error }),
})
