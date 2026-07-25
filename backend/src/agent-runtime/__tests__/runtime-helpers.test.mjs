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
  test('loads structural handlers from the active backend build', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const cases = [
      {
        skillId: 'beam',
        dimension: '2d',
        state: {
          inferredType: 'beam',
          skillId: 'beam',
          lengthM: 3,
          supportType: 'cantilever',
          loadKN: 10,
          loadType: 'point',
          loadPosition: 'midspan',
        },
      },
      {
        skillId: 'frame',
        dimension: '3d',
        state: {
          inferredType: 'frame',
          skillId: 'frame',
          frameDimension: '3d',
          storyCount: 1,
          bayCountX: 1,
          bayCountY: 1,
          storyHeightsM: [3],
          bayWidthsXM: [6],
          bayWidthsYM: [5],
          floorLoads: [{ story: 1, verticalKN: 10 }],
          frameBaseSupportType: 'fixed',
        },
      },
      {
        skillId: 'concrete-frame',
        dimension: '2d',
        state: {
          inferredType: 'concrete-frame',
          skillId: 'concrete-frame',
          frameDimension: '2d',
          storyCount: 2,
          bayCount: 1,
          storyHeightsM: [3, 3],
          bayWidthsM: [6],
          floorLoads: [
            { story: 1, verticalKN: 10 },
            { story: 2, verticalKN: 10 },
          ],
          frameBaseSupportType: 'fixed',
        },
      },
    ];

    for (const fixture of cases) {
      const model = await runtime.buildModel(fixture.state, [fixture.skillId]);
      expect(model?.coordinate_system).toEqual({
        semantics: 'global-z-up',
        version: 1,
        dimension: fixture.dimension,
        plane: fixture.dimension === '2d' ? 'xz' : null,
        dof_order: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
      });
    }
  });

  test('resolves structure type key aliases to the owning skill plugin', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    expect((await runtime.resolvePluginForType('frame'))?.id).toBe('frame');
    expect((await runtime.resolvePluginForType('steel-frame'))?.id).toBe('frame');
    expect((await runtime.resolvePluginForType('concrete-frame'))?.id).toBe('concrete-frame');
  });

  test('resolves latest GB50011 seismic code aliases to the GB50011 code-check skill', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();

    expect(runtime.resolveCodeCheckSkillId('GB50011')).toBe('code-check-gb50011');
    expect(runtime.resolveCodeCheckSkillId('GB/T 50011-2010-2024')).toBe('code-check-gb50011');
    expect(runtime.resolveCodeCheckSkillId('GB 55002+GB/T 50011')).toBe('code-check-gb50011');
  });

  test('report summaries include failed warning and not-applicable code-check counts', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const codeCheck = {
      summary: {
        total: 4,
        passed: 1,
        failed: 1,
        warnings: 1,
        notApplicable: 1,
      },
    };

    const zh = await runtime.executeReportSkill({
      message: '生成报告',
      analysisType: 'seismic',
      analysis: { success: true, data: {} },
      codeCheck,
      format: 'markdown',
      locale: 'zh',
    });
    const en = await runtime.executeReportSkill({
      message: 'Generate report',
      analysisType: 'seismic',
      analysis: { success: true, data: {} },
      codeCheck,
      format: 'markdown',
      locale: 'en',
    });

    expect(zh.report.summary).toContain('校核通过 1 / 4，失败 1，警告 1，不适用/资料不足 1');
    expect(en.report.summary).toContain('Code checks passed 1 / 4, failed 1, warnings 1, not applicable/unavailable 1');
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

  test('routes structure types correctly within the China seismic baseline skill scope', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const seismicBaseline = [
      'generic',
      'frame',
      'concrete-frame',
      'opensees-seismic',
      'code-check-gb50011',
      'validation-structure-model',
      'report-export-builtin',
    ];

    await expect(runtime.resolvePluginForType('concrete-frame', seismicBaseline))
      .resolves.toMatchObject({ id: 'concrete-frame' });
    await expect(runtime.resolvePluginForType('steel-frame', seismicBaseline))
      .resolves.toMatchObject({ id: 'frame' });

    await expect(runtime.detectStructuralType(
      '三层两跨钢筋混凝土框架，层高3.6m，跨度6m，8度第三组III类场地',
      'zh',
      undefined,
      seismicBaseline,
    )).resolves.toMatchObject({
      key: 'concrete-frame',
      mappedType: 'frame',
      skillId: 'concrete-frame',
    });
    await expect(runtime.detectStructuralType(
      '三层两跨钢框架，层高3.6m，跨度6m，8度第三组III类场地',
      'zh',
      undefined,
      seismicBaseline,
    )).resolves.toMatchObject({
      key: 'steel-frame',
      mappedType: 'frame',
      skillId: 'frame',
    });
    await expect(runtime.detectStructuralType(
      '办公楼，三层，按中国抗震考虑',
      'zh',
      undefined,
      seismicBaseline,
    )).resolves.toMatchObject({
      key: 'unknown',
      mappedType: 'unknown',
      skillId: 'generic',
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

  test('benchmark LLM-only mode rejects unusable router output instead of using rule hints', async () => {
    const previous = process.env.SCLAW_BENCHMARK_LLM_ONLY;
    process.env.SCLAW_BENCHMARK_LLM_ONLY = '1';
    try {
      const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
      const runtime = new AgentSkillRuntime();
      await expect(runtime.detectStructuralTypeWithLlm(
        {
          invoke: async () => ({
            content: 'not-json',
            response_metadata: { finish_reason: 'length' },
            additional_kwargs: { reasoning_content: 'reasoning only' },
          }),
        },
        'A two-story steel frame',
        'en',
      )).rejects.toThrow(
        'finishReason=length; contentLength=8; reasoningContentLength=14',
      );
    } finally {
      if (previous === undefined) delete process.env.SCLAW_BENCHMARK_LLM_ONLY;
      else process.env.SCLAW_BENCHMARK_LLM_ONLY = previous;
    }
  });

  test('benchmark LLM-only mode routes unsupported structures through the LLM instead of keyword shortcuts', async () => {
    const previous = process.env.SCLAW_BENCHMARK_LLM_ONLY;
    process.env.SCLAW_BENCHMARK_LLM_ONLY = '1';
    let invocations = 0;
    let routerPrompt = '';
    try {
      const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
      const runtime = new AgentSkillRuntime();
      const match = await runtime.detectStructuralTypeWithLlm(
        {
          invoke: async (prompt) => {
            invocations += 1;
            routerPrompt = String(prompt);
            return {
              content: JSON.stringify({
                action: 'unsupported',
                structuralTypeKey: 'bridge',
                mappedType: 'unknown',
                supportLevel: 'unsupported',
                confidence: 0.98,
                reason: 'Moving-load bridge workflows are outside the available skills.',
              }),
            };
          },
        },
        'Build a three-span bridge model with moving vehicle loads.',
        'en',
      );

      expect(invocations).toBe(1);
      expect(routerPrompt).toContain('Rule hint:\nnull');
      expect(routerPrompt).not.toContain('"routingSource": "explicit-keyword"');
      expect(match).toMatchObject({
        key: 'bridge',
        mappedType: 'unknown',
        supportLevel: 'unsupported',
        routingSource: 'llm-suggested',
      });
      expect(match.skillId).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.SCLAW_BENCHMARK_LLM_ONLY;
      else process.env.SCLAW_BENCHMARK_LLM_ONLY = previous;
    }
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

  test('LLM semantic extraction preserves seismic workflow in runtime draft state', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    const seismicWorkflow = {
      methodPreference: 'time_history',
      designBasis: {
        codes: ['GB 55002-2021', 'GB/T 50011-2010-2024'],
        siteSeismic: { intensity: 8, designGroup: '3', siteCategory: 'III' },
      },
      groundMotionSet: { requiredCount: 3 },
      directions: ['x', 'y'],
    };
    const fakeLlm = {
      async invoke(prompt) {
        const content = String(prompt);
        if (content.includes('结构类型路由器')) {
          return {
            content: JSON.stringify({
              action: 'switch_skill',
              skillId: 'concrete-frame',
              structuralTypeKey: 'concrete-frame',
              mappedType: 'frame',
              supportLevel: 'supported',
              confidence: 0.95,
              reason: '钢筋混凝土框架建筑',
            }),
          };
        }
        expect(content).toContain('skillState.seismicWorkflow');
        expect(content).toContain('不要用关键词或正则匹配决定 response_spectrum/time_history/pushover/elastic_plastic_time_history');
        expect(content).toContain('steelSeismicDetailing');
        expect(content).toContain('strongShearWeakBending');
        return {
          content: JSON.stringify({
            inferredType: 'concrete-frame',
            draftPatch: {
              frameDimension: '2d',
              storyCount: 3,
              bayCount: 2,
              storyHeightsM: [3.6, 3.6, 3.6],
              bayWidthsM: [6, 6],
              frameBaseSupportType: 'fixed',
              frameConcreteGrade: 'C30',
              frameRebarGrade: 'HRB400',
            },
            skillState: { seismicWorkflow },
          }),
        };
      },
    };

    const result = await runtime.extractDraftParameters(
      fakeLlm,
      '三层两跨钢筋混凝土框架，8度第三组III类场地，做中国抗震时程分析',
      undefined,
      'zh',
      ['concrete-frame'],
    );

    expect(result.structuralTypeMatch).toMatchObject({
      skillId: 'concrete-frame',
      routingSource: 'llm-suggested',
    });
    expect(result.extractionMode).toBe('llm');
    expect(result.nextState).toMatchObject({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      skillId: 'concrete-frame',
      storyCount: 3,
      bayCount: 2,
    });
    expect(result.nextState.skillState?.seismicWorkflow).toEqual(seismicWorkflow);
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

  test('unresolved issues on defaultable fields block legacy execution and model building', async () => {
    const {
      buildLegacyModel,
      computeLegacyMissing,
      mergeLegacyState,
      normalizeLegacyDraftPatch,
    } = await import('../../../dist/agent-runtime/legacy.js');

    const patch = normalizeLegacyDraftPatch({
      inferredType: 'beam',
      lengthM: 6,
      supportType: 'simply-supported',
      loadKN: 20,
      draftIssues: [{
        field: 'loadType',
        severity: 'ambiguous',
        reason: 'The value 20 could be a point load in kN or a line load in kN/m.',
      }],
    });
    const state = mergeLegacyState(undefined, patch, 'beam', 'beam');
    const allowedKeys = ['lengthM', 'supportType', 'loadKN', 'loadType', 'loadPosition'];

    expect(computeLegacyMissing(state, 'execution', allowedKeys).critical).toContain('loadType');
    expect(buildLegacyModel(state, allowedKeys)).toBeUndefined();
  });

  test('structured engineering-draft issue paths block legacy execution until corrected', async () => {
    const {
      buildLegacyModel,
      computeLegacyMissing,
      mergeLegacyState,
      normalizeLegacyDraftPatch,
    } = await import('../../../dist/agent-runtime/legacy.js');

    const patch = normalizeLegacyDraftPatch({
      inferredType: 'beam',
      engineeringDraft: {
        structureType: 'beam',
        geometry: { lengthM: 100000 },
        sections: { beam: '1mm' },
        boundary: { supportType: 'simply-supported' },
        loads: [{
          kind: 'distributed',
          magnitude: 999999999,
          unit: 'kN/m',
          direction: 'gravity',
          target: 'beam',
        }],
      },
      draftIssues: [
        {
          field: 'geometry.lengthM',
          severity: 'unrealistic',
          reason: 'The span requires confirmation.',
          question: 'Please confirm the intended span.',
        },
        {
          field: 'sections.beam',
          severity: 'unrealistic',
          reason: 'The section depth requires confirmation.',
          question: 'Please provide the intended beam section.',
        },
        {
          field: 'loads[0].magnitude',
          severity: 'unrealistic',
          reason: 'The load requires confirmation.',
          question: 'Please confirm the intended load.',
        },
      ],
    });
    const state = mergeLegacyState(undefined, patch, 'beam', 'beam');
    const allowedKeys = ['lengthM', 'supportType', 'loadKN', 'loadType', 'loadPosition'];

    expect(computeLegacyMissing(state, 'execution', allowedKeys).critical).toEqual(expect.arrayContaining([
      'geometry.lengthM',
      'sections.beam',
      'loads[0].magnitude',
    ]));
    expect(buildLegacyModel(state, allowedKeys)).toBeUndefined();

    const correctedPatch = normalizeLegacyDraftPatch({
      engineeringDraft: {
        geometry: { lengthM: 6 },
        sections: { beam: 'H400x200x8x13' },
        loads: [{
          kind: 'distributed',
          magnitude: 20,
          unit: 'kN/m',
          direction: 'gravity',
          target: 'beam',
        }],
      },
    });
    const correctedState = mergeLegacyState(state, correctedPatch, 'beam', 'beam');

    expect(computeLegacyMissing(correctedState, 'execution', allowedKeys).critical).not.toEqual(expect.arrayContaining([
      'geometry.lengthM',
      'sections.beam',
      'loads[0].magnitude',
    ]));
  });

  test('structured issue questions retain the engineering reason and requested correction', async () => {
    const { buildInteractionQuestions } = await import('../../../dist/agent-runtime/fallback.js');
    const [question] = buildInteractionQuestions(
      ['geometry.lengthM'],
      ['geometry.lengthM'],
      {
        inferredType: 'beam',
        updatedAt: 0,
        draftIssues: [{
          field: 'geometry.lengthM',
          severity: 'unrealistic',
          reason: 'The stated span is physically implausible.',
          question: 'Please confirm the intended span.',
        }],
      },
      'en',
    );

    expect(question).toEqual(expect.objectContaining({
      paramKey: 'geometry.lengthM',
      critical: true,
      question: 'The stated span is physically implausible. Please confirm the intended span.',
    }));
    expect(question.suggestedValue).toBeUndefined();
  });

  test('runtime refuses model building whenever the selected skill reports critical missing input', async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    const runtime = new AgentSkillRuntime();
    runtime.getRegistry().resolvePluginForState = async () => ({
      id: 'test-critical-guard',
      handler: {
        computeMissing: () => ({ critical: ['loadType'], optional: [] }),
        buildModel: () => {
          throw new Error('buildModel must not be called while critical input is unresolved');
        },
      },
    });

    await expect(runtime.buildModel({
      inferredType: 'beam',
      updatedAt: 0,
    })).resolves.toBeUndefined();
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

  test('valid support positions may start at the global origin', async () => {
    const { mergeDraftState } = await import('../../../dist/agent-runtime/fallback.js');

    const state = mergeDraftState({
      inferredType: 'beam',
      skillState: { invalidDraftFields: ['boundary.supportPositionsM'] },
      draftIssues: [{
        field: 'boundary.supportPositionsM',
        severity: 'invalid',
        reason: 'Support positions must be valid coordinates.',
      }],
      updatedAt: 0,
    }, {
      engineeringDraft: {
        boundary: { supportPositionsM: [0, 6] },
      },
    });

    expect(state.skillState?.invalidDraftFields ?? []).not.toContain('boundary.supportPositionsM');
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

  test('preserves distinct named load cases and explicit combinations', async () => {
    const {
      mergeEngineeringDraft,
      normalizeEngineeringDraft,
    } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const dead = normalizeEngineeringDraft({
      structureType: 'steel-frame',
      loads: [{
        kind: 'line',
        magnitude: 10,
        unit: 'kN/m',
        direction: 'gravity',
        target: 'floor beam',
        loadCaseId: 'D',
        loadCaseType: 'dead',
      }],
    });
    const live = normalizeEngineeringDraft({
      loads: [{
        kind: 'line',
        magnitude: 8,
        unit: 'kN/m',
        direction: 'gravity',
        target: 'floor beam',
        caseId: 'L',
        caseType: 'live',
      }],
      analysis: {
        type: 'static',
        loadCombinations: [{ id: 'ULS', factors: { D: 1.2, L: 1.4 } }],
      },
    });
    const merged = mergeEngineeringDraft(dead, live);

    expect(merged?.loads).toEqual([
      expect.objectContaining({ magnitude: 10, caseId: 'D', caseType: 'dead' }),
      expect.objectContaining({ magnitude: 8, caseId: 'L', caseType: 'live' }),
    ]);
    expect(merged?.analysis?.loadCombinations).toEqual([
      { id: 'ULS', factors: { D: 1.2, L: 1.4 } },
    ]);
  });

  test('deduplicates equivalent load aliases emitted in one engineering draft', async () => {
    const { mergeEngineeringDraft } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const merged = mergeEngineeringDraft(undefined, {
      structureType: 'steel-frame',
      geometry: { storyHeightsM: [12], bayWidthsM: [24] },
      loads: [
        {
          kind: 'line',
          magnitude: 36,
          unit: 'kN/m',
          direction: 'gravity',
          target: 'roof beam',
          location: { story: 1 },
          caseId: 'D',
        },
        {
          kind: 'distributed',
          magnitude: 36,
          unit: 'kN/m',
          direction: 'gravity',
          target: 'story 1 beam',
          location: { story: 1 },
          caseId: 'D',
        },
        {
          kind: 'point',
          magnitude: 98,
          unit: 'kN',
          direction: 'gravity',
          target: 'right column top',
          location: { story: 1, nodeRole: 'right-side' },
          caseId: 'C',
        },
        {
          kind: 'nodal',
          magnitude: 98,
          unit: 'kN',
          direction: 'gravity',
          target: 'right roof joint',
          location: { story: 1, nodeRole: 'right-side' },
          caseId: 'C',
        },
      ],
      analysis: {
        loadCombinations: [{ id: 'ULS', factors: { D: 1, C: 1 } }],
      },
    });

    expect(merged?.loads).toEqual([
      expect.objectContaining({ kind: 'distributed', magnitude: 36, caseId: 'D' }),
      expect.objectContaining({ kind: 'nodal', magnitude: 98, caseId: 'C' }),
    ]);
  });

  test('treats span 1 and omitted locations as the same full-span load for a single-span beam', async () => {
    const { mergeDraftState } = await import('../../../dist/agent-runtime/fallback.js');

    const first = mergeDraftState(undefined, {
      engineeringDraft: {
        structureType: 'beam',
        geometry: { lengthM: 6 },
        loads: [
          {
            kind: 'distributed',
            magnitude: 20,
            unit: 'kN/m',
            direction: 'gravity',
            target: 'beam',
            location: { spanIndex: 1 },
          },
        ],
      },
    });
    const second = mergeDraftState(first, {
      engineeringDraft: {
        structureType: 'beam',
        loads: [
          {
            kind: 'distributed',
            magnitude: 20,
            unit: 'kN/m',
            direction: 'gravity',
            target: 'beam',
          },
          {
            kind: 'point',
            magnitude: 30,
            unit: 'kN',
            direction: 'gravity',
            target: 'beam',
            location: { xM: 3, nodeRole: 'midspan' },
          },
        ],
      },
    });

    expect(second.engineeringDraft?.loads).toEqual([
      {
        kind: 'distributed',
        magnitude: 20,
        unit: 'kN/m',
        direction: 'gravity',
        target: 'beam',
        location: { spanIndex: 1 },
      },
      {
        kind: 'point',
        magnitude: 30,
        unit: 'kN',
        direction: 'gravity',
        target: 'beam',
        location: { xM: 3, nodeRole: 'midspan' },
      },
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

  test('prefers structured story locations when projecting frame floor loads', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'concrete-frame',
        geometry: {
          storyHeightsM: [3.6, 3.6],
          bayWidthsM: [6],
        },
        loads: [
          {
            kind: 'area',
            magnitude: 8,
            unit: 'kN/m2',
            direction: 'gravity',
            target: 'floor 1',
            location: { story: 2 },
          },
          {
            kind: 'area',
            magnitude: 5,
            unit: 'kN/m2',
            direction: 'gravity',
            location: { story: 1 },
          },
        ],
      },
    }, 'frame');

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 180 },
      { story: 2, verticalKN: 288 },
    ]);
  });

  test('preserves explicitly located frame nodal loads instead of projecting them as floor totals', async () => {
    const { projectEngineeringDraftToLegacyPatch } = await import('../../../dist/agent-runtime/engineering-draft.js');

    const patch = projectEngineeringDraftToLegacyPatch({
      engineeringDraft: {
        structureType: 'steel-frame',
        geometry: {
          storyHeightsM: [3, 3, 3],
          bayWidthsM: [6, 6],
        },
        loads: [
          {
            kind: 'nodal',
            magnitude: 10,
            unit: 'kN',
            direction: 'globalX',
            location: { story: 1, nodeRole: 'right-side' },
          },
          {
            kind: 'nodal',
            magnitude: 15,
            unit: 'kN',
            direction: 'globalX',
            location: { story: 2, nodeRole: 'right-side' },
          },
          {
            kind: 'nodal',
            magnitude: 20,
            unit: 'kN',
            direction: 'globalX',
            location: { story: 3, nodeRole: 'right-side' },
          },
        ],
      },
    }, 'frame');

    expect(patch.engineeringDraft?.loads?.map((load) => load.location)).toEqual([
      { story: 1, nodeRole: 'right-side' },
      { story: 2, nodeRole: 'right-side' },
      { story: 3, nodeRole: 'right-side' },
    ]);
    expect(patch.floorLoads).toBeUndefined();
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
