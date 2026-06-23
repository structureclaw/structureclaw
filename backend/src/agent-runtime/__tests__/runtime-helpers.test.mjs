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

  test('keeps owning plugin enabled when scope uses a structural type key', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    expect((await runtime.resolvePluginForType('steel-frame', ['steel-frame']))?.id).toBe('frame');

    const match = await runtime.detectStructuralType(
      '2层单跨钢框架，层高3.6m，跨度6m，请建立模型并进行静力分析。',
      'zh',
      undefined,
      ['steel-frame'],
    );

    expect(match).toMatchObject({
      key: 'steel-frame',
      mappedType: 'frame',
      skillId: 'frame',
      supportLevel: 'supported',
      routingSource: 'explicit-keyword',
    });
  });

  test('routes broad building descriptions without material or system cues to generic fallback', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    const match = await runtime.detectStructuralType(
      '办公楼，三层',
      'zh',
    );

    expect(match).toMatchObject({
      key: 'unknown',
      mappedType: 'unknown',
      skillId: 'generic',
      supportLevel: 'fallback',
      routingSource: 'generic-fallback',
    });
  });

  test('keeps stable current draft when a follow-up does not explicitly switch type', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    const match = await runtime.detectStructuralType(
      '柱顶荷载增加20kN',
      'zh',
      {
        inferredType: 'frame',
        structuralTypeKey: 'concrete-frame',
        skillId: 'concrete-frame',
        supportLevel: 'supported',
        updatedAt: 0,
      },
    );

    expect(match).toMatchObject({
      key: 'concrete-frame',
      mappedType: 'frame',
      skillId: 'concrete-frame',
      routingSource: 'current-state',
    });
  });

  test('allows explicit structure-type switches over current draft state', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    const match = await runtime.detectStructuralType(
      '改成简支梁跨度6m',
      'zh',
      {
        inferredType: 'frame',
        structuralTypeKey: 'concrete-frame',
        skillId: 'concrete-frame',
        supportLevel: 'supported',
        updatedAt: 0,
      },
    );

    expect(match).toMatchObject({
      key: 'beam',
      mappedType: 'beam',
      skillId: 'beam',
      routingSource: 'explicit-keyword',
    });
  });

  test('uses LLM router decision instead of locking broad new requests to the current draft', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const fakeRouterLlm = {
      invoke: async () => ({
        content: JSON.stringify({
          action: 'generic',
          skillId: 'generic',
          structuralTypeKey: 'unknown',
          mappedType: 'unknown',
          supportLevel: 'fallback',
          confidence: 0.88,
          reason: '新的办公楼柱网描述不应继续旧梁草稿',
        }),
      }),
    };

    const match = await runtime.detectStructuralTypeWithLlm(
      fakeRouterLlm,
      '办公楼，混凝土柱网，三层',
      'zh',
      {
        inferredType: 'beam',
        structuralTypeKey: 'beam',
        skillId: 'beam',
        supportLevel: 'supported',
        lengthM: 6,
        updatedAt: 0,
      },
    );

    expect(match).toMatchObject({
      key: 'unknown',
      mappedType: 'unknown',
      skillId: 'generic',
      supportLevel: 'fallback',
      routingSource: 'llm-suggested',
    });
  });

  test('falls back to rule hints without re-locking the current draft when LLM routing is unusable', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const fakeRouterLlm = {
      invoke: async () => ({
        content: JSON.stringify({
          action: 'continue_current',
          confidence: 0.1,
          reason: '低置信度，不能继续沿用旧梁',
        }),
      }),
    };

    const match = await runtime.detectStructuralTypeWithLlm(
      fakeRouterLlm,
      '五层混凝土办公楼，柱网8m×8m，层高3.6m',
      'zh',
      {
        inferredType: 'beam',
        structuralTypeKey: 'beam',
        skillId: 'beam',
        supportLevel: 'supported',
        lengthM: 6,
        updatedAt: 0,
      },
    );

    expect(match).toMatchObject({
      key: 'concrete-frame',
      mappedType: 'frame',
      skillId: 'concrete-frame',
      supportLevel: 'supported',
      routingSource: 'explicit-keyword',
    });
  });

  test('resets stale draft state when the LLM routes a stable draft to generic', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const fakeRouterLlm = {
      invoke: async () => ({
        content: JSON.stringify({
          action: 'generic',
          skillId: 'generic',
          structuralTypeKey: 'unknown',
          mappedType: 'unknown',
          supportLevel: 'fallback',
          confidence: 0.9,
          reason: '新输入需要重新澄清结构类型',
        }),
      }),
    };

    const result = await runtime.extractDraftParameters(
      fakeRouterLlm,
      '办公楼，三层',
      {
        inferredType: 'beam',
        structuralTypeKey: 'beam',
        skillId: 'beam',
        supportLevel: 'supported',
        lengthM: 6,
        supportType: 'simply-supported',
        loadKN: 20,
        updatedAt: 0,
      },
      'zh',
    );

    expect(result.structuralTypeMatch).toMatchObject({
      key: 'unknown',
      mappedType: 'unknown',
      skillId: 'generic',
      routingSource: 'llm-suggested',
    });
    expect(result.nextState).toMatchObject({
      inferredType: 'unknown',
      structuralTypeKey: 'unknown',
      skillId: 'generic',
      routingSource: 'llm-suggested',
    });
    expect(result.missing.critical).toContain('inferredType');
    expect(result.extractionMode).toBe('deterministic');
  });

  test('requires an LLM for LLM-first structural routing', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    await expect(runtime.detectStructuralTypeWithLlm(
      null,
      '简支梁跨度6m',
      'zh',
    )).rejects.toThrow('LLM 未配置');
  });

  test('does not preserve old draft over an LLM-suggested generic route', async () => {
    const { shouldPreserveExistingDraftState } = await import('../../../dist/agent-langgraph/tools.js');

    expect(shouldPreserveExistingDraftState(
      {
        inferredType: 'beam',
        structuralTypeKey: 'beam',
        skillId: 'beam',
        supportLevel: 'supported',
        lengthM: 6,
        updatedAt: 0,
      },
      {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
        routingSource: 'llm-suggested',
      },
      '办公楼，混凝土柱网，三层',
    )).toBe(false);
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
      routingSource: 'explicit-keyword',
      skillId: 'beam',
    });

    expect(parsed.stage).toBe('model');
    expect(parsed.routingSource).toBe('explicit-keyword');
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

  test('detectStructuralType does not treat member parameter edits as structural switches', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    const match = await runtime.detectStructuralType('change height to 4m for the column', 'en', {
      inferredType: 'frame',
      skillId: 'frame',
      structuralTypeKey: 'steel-frame',
      storyCount: 2,
      bayCount: 1,
      updatedAt: 0,
    });

    expect(match.skillId).toBe('frame');
    expect(match.mappedType).toBe('frame');
  });

  test('detectStructuralType handles explicit English switches with articles', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    const match = await runtime.detectStructuralType('change to a beam', 'en', {
      inferredType: 'frame',
      skillId: 'frame',
      structuralTypeKey: 'steel-frame',
      storyCount: 2,
      bayCount: 1,
      updatedAt: 0,
    });

    expect(match.skillId).toBe('beam');
    expect(match.mappedType).toBe('beam');
  });

  test('valid engineering draft span arrays clear prior invalid span issues', async () => {
    const { mergeDraftState } = await import('../../../dist/agent-runtime/fallback.js');

    const state = mergeDraftState({
      inferredType: 'portal-frame',
      skillState: { invalidDraftFields: ['spanLengthsM'] },
      draftIssues: [{
        field: 'spanLengthsM',
        severity: 'invalid',
        reason: 'Span lengths must be positive.',
      }],
      updatedAt: 0,
    }, {
      engineeringDraft: {
        geometry: { spanLengthsM: [18, 18] },
      },
    });

    expect(state.skillState?.invalidDraftFields ?? []).not.toContain('spanLengthsM');
    expect(state.draftIssues ?? []).toEqual([]);
  });

  test('merges engineering draft loads without duplicating repeated load definitions', async () => {
    const { mergeDraftState } = await import('../../../dist/agent-runtime/fallback.js');

    const first = mergeDraftState(undefined, {
      engineeringDraft: {
        structureType: 'frame',
        loads: [
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', target: 'floor 1' },
        ],
      },
    });
    const second = mergeDraftState(first, {
      engineeringDraft: {
        structureType: 'frame',
        loads: [
          { kind: 'line', magnitude: 12, unit: 'kN/m', direction: 'gravity', target: 'floor 1' },
          { kind: 'point', magnitude: 30, unit: 'kN', direction: 'globalX', target: 'roof' },
        ],
      },
    });

    expect(second.engineeringDraft?.loads).toEqual([
      { kind: 'line', magnitude: 12, unit: 'kN/m', direction: 'gravity', target: 'floor 1' },
      { kind: 'point', magnitude: 30, unit: 'kN', direction: 'globalX', target: 'roof' },
    ]);
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

  test('does not project frame line loads into floor loads but keeps point lateral loads', async () => {
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

    expect(patch.engineeringDraft?.loads?.[0]).toMatchObject({ kind: 'line', magnitude: 10, unit: 'kN/m' });
    expect(patch.floorLoads).toEqual([
      { story: 2, lateralXKN: 20 },
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
    });
    expect(patch.floorLoads).toBeUndefined();
    expect(patch.bayCountX).toBeUndefined();
    expect(patch.bayWidthsXM).toBeUndefined();
  });

  test('maps partial untargeted frame point loads by order instead of duplicating to every story', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3, 3, 3],
          bayWidthsM: [6],
        },
        loads: [
          { kind: 'point', magnitude: 60, unit: 'kN', direction: 'gravity' },
          { kind: 'point', magnitude: 72, unit: 'kN', direction: 'gravity' },
        ],
      },
    }, 'frame');

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 60 },
      { story: 2, verticalKN: 72 },
    ]);
  });

  test('parses compound Chinese story ordinals for targeted frame point loads', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: Array.from({ length: 12 }, () => 3),
          bayWidthsM: [5],
        },
        loads: [
          { kind: 'point', magnitude: 10, unit: 'kN', direction: 'gravity', target: '第十一层' },
        ],
      },
    }, 'frame');

    expect(patch.floorLoads).toEqual([{ story: 11, verticalKN: 10 }]);
  });

  test('parses Chinese top-story targets without treating member tops as roof stories', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const topStoryPatch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3, 3, 3],
          bayWidthsM: [5],
        },
        loads: [
          { kind: 'point', magnitude: 10, unit: 'kN', direction: 'gravity', target: '顶层' },
        ],
      },
    }, 'frame');
    const memberTopPatch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3, 3, 3],
          bayWidthsM: [5],
        },
        loads: [
          { kind: 'point', magnitude: 5, unit: 'kN', direction: 'gravity', target: '柱顶' },
        ],
      },
    }, 'frame');

    expect(topStoryPatch.floorLoads).toEqual([{ story: 3, verticalKN: 10 }]);
    expect(memberTopPatch.floorLoads).toEqual([
      { story: 1, verticalKN: 5 },
      { story: 2, verticalKN: 5 },
      { story: 3, verticalKN: 5 },
    ]);
  });

  test('does not duplicate excess untargeted frame point loads onto every story', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3, 3],
          bayWidthsM: [5],
        },
        loads: [
          { kind: 'point', magnitude: 5, unit: 'kN', direction: 'gravity' },
          { kind: 'point', magnitude: 10, unit: 'kN', direction: 'gravity' },
          { kind: 'point', magnitude: 15, unit: 'kN', direction: 'gravity' },
        ],
      },
    }, 'frame');

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 5 },
      { story: 2, verticalKN: 10 },
    ]);
  });

  test('does not convert frame load intensity into fallback floor totals', async () => {
    const { mergeDraftState } = await import('../../../dist/agent-runtime/fallback.js');
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3, 3],
        },
        loads: [
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity' },
        ],
      },
    }, 'frame');
    const state = mergeDraftState(undefined, patch);

    expect(patch.loadKN).toBeUndefined();
    expect(state.floorLoads).toBeUndefined();
  });
});
