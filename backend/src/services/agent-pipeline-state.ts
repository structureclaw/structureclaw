import type {
  ProjectExecutionPolicy,
  RequestExecutionOverrides,
  ProjectPipelineState,
  InteractionCheckpoint,
  CheckpointKind,
  ArtifactKind,
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

/**
 * Merge request overrides into project policy with three-level priority:
 * explicit override → project policy → bootstrap defaults.
 * Only allowlisted override fields are applied.
 */
export function mergeExecutionPolicy(
  projectPolicy: ProjectExecutionPolicy,
  overrides: RequestExecutionOverrides | undefined,
  defaults: ProjectExecutionPolicy = BOOTSTRAP_EXECUTION_DEFAULTS,
): ProjectExecutionPolicy {
  return {
    ...defaults,
    ...projectPolicy,
    analysisType: overrides?.analysisType ?? projectPolicy.analysisType ?? defaults.analysisType,
    designCode: overrides?.designCode ?? projectPolicy.designCode ?? defaults.designCode,
    allowAsync: overrides?.allowAsync ?? projectPolicy.allowAsync ?? defaults.allowAsync,
    autoDesignIterationPolicy: projectPolicy.autoDesignIterationPolicy
      ? {
        ...projectPolicy.autoDesignIterationPolicy,
        enabled: overrides?.autoDesignIterationEnabled ?? projectPolicy.autoDesignIterationPolicy.enabled,
      }
      : defaults.autoDesignIterationPolicy,
    deliverableProfiles: {
      ...(defaults.deliverableProfiles ?? {}),
      ...(projectPolicy.deliverableProfiles ?? {}),
      ...(overrides?.deliverableProfiles ?? {}),
    },
  };
}

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

export function buildInteractionCheckpoint(input: {
  kind: CheckpointKind;
  summary: string;
  targetArtifact?: ArtifactKind;
  patchId?: string;
}): InteractionCheckpoint {
  return {
    checkpointId: `checkpoint:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    kind: input.kind,
    targetArtifact: input.targetArtifact,
    patchId: input.patchId,
    summary: input.summary,
    createdAt: Date.now(),
  };
}
