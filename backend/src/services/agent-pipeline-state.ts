import type {
  AgentExecutionPolicy,
  ConversationPipelineState,
} from '../agent-runtime/types.js';

export const BOOTSTRAP_EXECUTION_DEFAULTS: AgentExecutionPolicy = {
  analysisType: 'static',
  allowAsync: false,
  autoDesignIterationPolicy: {
    enabled: false,
    maxIterations: 3,
    acceptanceCriteria: ['allChecksPass'],
    allowedDomains: ['design'],
  },
};

export function createEmptyConversationPipelineState(
  policy: AgentExecutionPolicy = {},
): ConversationPipelineState {
  return {
    policy,
    bindings: {},
    artifacts: {},
    updatedAt: Date.now(),
  };
}
