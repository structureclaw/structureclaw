import type {
  ProjectExecutionPolicy,
  ProjectPipelineState,
} from '../agent-runtime/types.js';

export const BOOTSTRAP_EXECUTION_DEFAULTS: ProjectExecutionPolicy = {
  analysisType: 'static',
  allowAsync: false,
  autoDesignIterationPolicy: {
    enabled: false,
    maxIterations: 3,
    acceptanceCriteria: ['allChecksPass'],
    allowedDomains: ['design'],
  },
};

export function createEmptyProjectPipelineState(
  policy: ProjectExecutionPolicy = {},
): ProjectPipelineState {
  return {
    policy,
    bindings: {},
    artifacts: {},
    updatedAt: Date.now(),
  };
}
