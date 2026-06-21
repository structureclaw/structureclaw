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
  test('resolves structure type key aliases to the owning skill plugin', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    expect((await runtime.resolvePluginForType('frame'))?.id).toBe('frame');
    expect((await runtime.resolvePluginForType('steel-frame'))?.id).toBe('frame');
    expect((await runtime.resolvePluginForType('concrete-frame'))?.id).toBe('concrete-frame');
  });

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

  test('legacy draft validation blocks non-positive model parameters until corrected', async () => {
    const {
      buildLegacyModel,
      computeLegacyMissing,
      mergeLegacyState,
      normalizeLegacyDraftPatch,
    } = await import('../../../dist/agent-runtime/legacy.js');

    const invalidPatch = normalizeLegacyDraftPatch({
      inferredType: 'beam',
      lengthM: -5,
      supportType: 'simply-supported',
      loadKN: 20,
    });
    const invalidState = mergeLegacyState(undefined, invalidPatch, 'beam', 'beam');

    expect(invalidState.skillState?.invalidDraftFields).toContain('lengthM');
    expect(computeLegacyMissing(invalidState, 'execution', ['lengthM', 'supportType', 'loadKN']).critical).toContain('lengthM');
    expect(buildLegacyModel(invalidState)).toBeUndefined();

    const correctedPatch = normalizeLegacyDraftPatch({ lengthM: 5 });
    const correctedState = mergeLegacyState(invalidState, correctedPatch, 'beam', 'beam');

    expect(correctedState.skillState?.invalidDraftFields ?? []).not.toContain('lengthM');
    expect(computeLegacyMissing(correctedState, 'execution', ['lengthM', 'supportType', 'loadKN']).critical).not.toContain('lengthM');
  });

  test('draft issues mark fields invalid even when invalidDraftFields is omitted', async () => {
    const {
      computeLegacyMissing,
      mergeLegacyState,
      normalizeLegacyDraftPatch,
    } = await import('../../../dist/agent-runtime/legacy.js');

    const patch = normalizeLegacyDraftPatch({
      inferredType: 'portal-frame',
      spanLengthM: 18,
      heightM: 6,
      draftIssues: [{
        field: 'loadKN',
        severity: 'ambiguous',
        reason: 'Negative roof load may mean uplift rather than gravity magnitude.',
      }],
    });
    const state = mergeLegacyState(undefined, patch, 'portal-frame', 'portal-frame');

    expect(state.draftIssues?.[0].field).toBe('loadKN');
    expect(state.skillState?.invalidDraftFields).toContain('loadKN');
    expect(computeLegacyMissing(state, 'execution', ['spanLengthM', 'heightM', 'loadKN']).critical).toContain('loadKN');
  });

  test('detectStructuralType keeps current portal-frame context for parameter updates', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    const match = await runtime.detectStructuralType('柱高改成9m', 'zh', {
      inferredType: 'portal-frame',
      skillId: 'portal-frame',
      structuralTypeKey: 'portal-frame',
      spanLengthM: 24,
      heightM: 8,
      loadKN: 10,
      updatedAt: 0,
    });

    expect(match.skillId).toBe('portal-frame');
    expect(match.mappedType).toBe('portal-frame');
  });

  test('projects frame area engineering loads into per-story floor loads', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'concrete-frame',
        geometry: {
          storyHeightsM: [3.6, 3.6],
          bayWidthsM: [6],
        },
        loads: [
          { kind: 'area', magnitude: 12, unit: 'kN/m2', direction: 'gravity', target: 'floor 1' },
          { kind: 'area', magnitude: 12, unit: 'kN/m2', direction: 'gravity', target: 'floor 2' },
        ],
      },
    }, 'frame');

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 432 },
      { story: 2, verticalKN: 432 },
    ]);
  });

  test('projects frame line and lateral engineering loads into floor loads', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3.3, 3.3],
          bayWidthsM: [5, 7],
        },
        loads: [
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity' },
          { kind: 'point', magnitude: 20, unit: 'kN', direction: 'globalX', target: 'roof' },
        ],
      },
    }, 'frame');

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 120 },
      { story: 2, verticalKN: 120, lateralXKN: 20 },
    ]);
  });

  test('treats x-only engineering frame spans as 2d geometry', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [4.5],
          bayWidthsXM: [6],
        },
        loads: [
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', target: 'beam' },
        ],
      },
    }, 'frame');

    expect(patch).toMatchObject({
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      bayWidthsM: [6],
      floorLoads: [{ story: 1, verticalKN: 60 }],
    });
    expect(patch.bayCountX).toBeUndefined();
    expect(patch.bayWidthsXM).toBeUndefined();
  });
});
