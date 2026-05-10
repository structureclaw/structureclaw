import { describe, expect, test } from '@jest/globals';
import {
  computeDependencyFingerprint,
  computeDraftStateContentHash,
} from '../../../dist/agent-runtime/artifact-helpers.js';
import {
  stampDraftSemantics,
  STRUCTURAL_COORDINATE_SEMANTICS,
} from '../../../dist/agent-runtime/coordinate-semantics.js';
import { buildElementReferenceVectors } from '../../../dist/agent-runtime/reference-vectors.js';
import { skillExecutionSchema } from '../../../dist/agent-runtime/schema.js';

describe('agent runtime helper utilities', () => {
  test('dependency fingerprints are stable regardless of reference insertion order', () => {
    const left = computeDependencyFingerprint({
      analysis: { artifactId: 'analysis-1', revision: 3 },
      model: { artifactId: 'model-1', revision: 2 },
    });
    const right = computeDependencyFingerprint({
      model: { artifactId: 'model-1', revision: 2 },
      analysis: { artifactId: 'analysis-1', revision: 3 },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{16}$/);
  });

  test('dependency fingerprints include provider bindings and draft state hashes', () => {
    const refs = {
      model: { artifactId: 'model-1', revision: 2 },
    };
    const base = computeDependencyFingerprint(refs);

    expect(computeDependencyFingerprint(refs, { analysisProviderSkillId: 'analysis-opensees-static' })).not.toBe(base);
    expect(computeDependencyFingerprint(refs, { codeCheckProviderSkillId: 'code-check-gb50017' })).not.toBe(base);
    expect(computeDependencyFingerprint(refs, undefined, 'draft-hash-1')).not.toBe(base);
  });

  test('draft state content hashes ignore updatedAt while tracking real content changes', () => {
    const first = computeDraftStateContentHash({
      inferredType: 'beam',
      lengthM: 6,
      loadKNPerM: 20,
      updatedAt: 100,
    });
    const second = computeDraftStateContentHash({
      updatedAt: 200,
      loadKNPerM: 20,
      lengthM: 6,
      inferredType: 'beam',
    });
    const changed = computeDraftStateContentHash({
      inferredType: 'beam',
      lengthM: 7,
      loadKNPerM: 20,
      updatedAt: 100,
    });

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });

  test('draft state content hashes are stable for nested objects while tracking nested changes', () => {
    const first = computeDraftStateContentHash({
      nested: {
        section: { heightM: 0.5, widthM: 0.25 },
        loads: [{ id: 'L1', value: 20 }],
      },
      updatedAt: 100,
    });
    const reordered = computeDraftStateContentHash({
      updatedAt: 200,
      nested: {
        loads: [{ value: 20, id: 'L1' }],
        section: { widthM: 0.25, heightM: 0.5 },
      },
    });
    const changed = computeDraftStateContentHash({
      nested: {
        section: { heightM: 0.5, widthM: 0.25 },
        loads: [{ id: 'L1', value: 25 }],
      },
      updatedAt: 100,
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  test('stampDraftSemantics adds global coordinate semantics without mutating input', () => {
    const draft = { inferredType: 'frame', storyCount: 2 };
    const stamped = stampDraftSemantics(draft);

    expect(stamped).toEqual({
      inferredType: 'frame',
      storyCount: 2,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
    });
    expect(stamped).not.toBe(draft);
    expect(draft).not.toHaveProperty('coordinateSemantics');
  });

  test('buildElementReferenceVectors assigns columns and beams while skipping invalid elements', () => {
    const nodes = [
      { id: 'N1', x: 0, y: 0, z: 0 },
      { id: 2, x: 0, y: 0, z: 3 },
      { id: 'N3', x: 5, y: 0, z: 3 },
      { id: 'bad', x: 'not-a-number', y: 0, z: 0 },
    ];
    const elements = [
      { id: 'C1', nodes: ['N1', 2] },
      { id: 'B1', nodes: [2, 'N3'] },
      { id: 'missing-node', nodes: ['N1', 'N404'] },
      { id: 42, nodes: ['N1', 'N3'] },
      { id: 'bad-coordinates', nodes: ['N1', 'bad'] },
    ];

    expect(buildElementReferenceVectors(elements, nodes)).toEqual({
      C1: [1, 0, 0],
      B1: [0, 0, 1],
    });
  });

  test('skillExecutionSchema accepts valid payloads and rejects invalid stages', () => {
    const parsed = skillExecutionSchema.parse({
      inferredType: 'beam',
      draftPatch: { lengthM: 6 },
      missingCritical: ['supportType'],
      questions: [{
        paramKey: 'supportType',
        label: 'Support type',
        question: 'What support type should be used?',
        required: true,
        critical: true,
      }],
      defaultProposals: [{
        paramKey: 'supportType',
        value: 'pinned',
        reason: 'Common default for simple beams',
      }],
      stage: 'model',
      supportLevel: 'supported',
      skillId: 'beam',
    });

    expect(parsed.stage).toBe('model');
    expect(parsed.questions?.[0].critical).toBe(true);
    expect(() => skillExecutionSchema.parse({ stage: 'design' })).toThrow();
  });
});
