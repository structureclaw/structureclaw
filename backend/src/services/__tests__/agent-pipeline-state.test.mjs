import { describe, expect, test } from '@jest/globals';
import {
  createEmptyConversationPipelineState,
} from '../../../dist/services/agent-pipeline-state.js';
import {
  computeDependencyFingerprint,
} from '../../../dist/agent-runtime/artifact-helpers.js';

describe('agent pipeline state helpers', () => {
  test('createEmptyConversationPipelineState returns empty but valid state', () => {
    const state = createEmptyConversationPipelineState({ designCode: 'GB50017' });
    expect(state.policy.designCode).toBe('GB50017');
    expect(state.bindings).toEqual({});
    expect(state.artifacts).toEqual({});
  });

  test('computeDependencyFingerprint is deterministic', () => {
    const fp1 = computeDependencyFingerprint({
      designBasis: { artifactId: 'a1', revision: 1 },
      normalizedModel: { artifactId: 'm1', revision: 2 },
    });
    const fp2 = computeDependencyFingerprint({
      designBasis: { artifactId: 'a1', revision: 1 },
      normalizedModel: { artifactId: 'm1', revision: 2 },
    });
    expect(fp1).toBe(fp2);
  });

  test('computeDependencyFingerprint changes when inputs differ', () => {
    const fp1 = computeDependencyFingerprint({
      designBasis: { artifactId: 'a1', revision: 1 },
    });
    const fp2 = computeDependencyFingerprint({
      designBasis: { artifactId: 'a1', revision: 2 },
    });
    expect(fp1).not.toBe(fp2);
  });
});
