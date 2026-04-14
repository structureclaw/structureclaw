import { describe, expect, test } from '@jest/globals';
import {
  mergeExecutionPolicy,
  buildInteractionCheckpoint,
  createEmptyProjectPipelineState,
} from '../../../dist/services/agent-pipeline-state.js';
import {
  canReuseArtifact,
  computeDependencyFingerprint,
} from '../../../dist/agent-runtime/artifact-helpers.js';

describe('agent pipeline state helpers', () => {
  test('request overrides only replace allowlisted execution fields', () => {
    const merged = mergeExecutionPolicy(
      {
        designCode: 'GB50017',
        allowAsync: false,
        analysisProviderPreference: 'analysis-a',
        autoDesignIterationPolicy: {
          enabled: false,
          maxIterations: 2,
          acceptanceCriteria: ['allChecksPass'],
          allowedDomains: ['design'],
        },
      },
      { allowAsync: true, autoDesignIterationEnabled: true },
    );

    expect(merged.designCode).toBe('GB50017');
    expect(merged.allowAsync).toBe(true);
    expect(merged.analysisProviderPreference).toBe('analysis-a');
    expect(merged.autoDesignIterationPolicy).toMatchObject({
      enabled: true,
      maxIterations: 2,
    });
  });

  test('creates design proposal checkpoints', () => {
    const checkpoint = buildInteractionCheckpoint({
      kind: 'design-proposal',
      targetArtifact: 'normalizedModel',
      patchId: 'patch-1',
      summary: 'Increase section size',
    });

    expect(checkpoint.kind).toBe('design-proposal');
    expect(checkpoint.patchId).toBe('patch-1');
  });

  test('createEmptyProjectPipelineState returns empty but valid state', () => {
    const state = createEmptyProjectPipelineState({ designCode: 'GB50017' });
    expect(state.policy.designCode).toBe('GB50017');
    expect(state.bindings).toEqual({});
    expect(state.artifacts).toEqual({});
  });

  test('canReuseArtifact rejects stale artifacts', () => {
    expect(canReuseArtifact(
      { status: 'stale', dependencyFingerprint: 'fp-1' },
      'fp-1',
      false,
    )).toBe(false);
  });

  test('canReuseArtifact accepts ready artifacts with matching fingerprint', () => {
    expect(canReuseArtifact(
      { status: 'ready', dependencyFingerprint: 'fp-1' },
      'fp-1',
      false,
    )).toBe(true);
  });

  test('canReuseArtifact rejects when forceRecompute is true', () => {
    expect(canReuseArtifact(
      { status: 'ready', dependencyFingerprint: 'fp-1' },
      'fp-1',
      true,
    )).toBe(false);
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
