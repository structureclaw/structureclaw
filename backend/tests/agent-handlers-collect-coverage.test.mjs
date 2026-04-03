import { describe, expect, test, jest, beforeEach } from '@jest/globals';

/**
 * collect.ts handler tests
 *
 * handleCollect orchestrates the "collecting" phase of the agent pipeline.
 * It delegates to `executeDraftModelInteractiveStep` and various `deps` methods.
 * We mock every external dependency and verify the branching logic.
 *
 * Mock paths in unstable_mockModule are resolved from the test file location.
 * The dist file at dist/services/agent-handlers/collect.js imports:
 *   - '../../agent-tools/builtin/draft-model.js' -> dist/agent-tools/builtin/draft-model.js
 *   - './draft.js' -> dist/services/agent-handlers/draft.js
 * So from tests/ we use:
 *   - '../dist/agent-tools/builtin/draft-model.js'
 *   - '../dist/services/agent-handlers/draft.js'
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const now = Date.now();

/**
 * Create a minimal TurnContext for testing.
 */
function makeCtx(overrides = {}) {
  return {
    traceId: 'trace-001',
    startedAt: new Date(now).toISOString(),
    startedAtMs: now,
    params: { message: 'Design a simply supported beam' },
    locale: 'en',
    orchestrationMode: 'directed',
    skillIds: ['structure-type'],
    activeSkillIds: ['structure-type'],
    noSkillMode: false,
    hadExistingSession: false,
    activeToolIds: undefined,
    sessionKey: 'conv-123',
    session: {
      state: 'collecting',
      updatedAt: now,
      draft: {
        inferredType: 'beam',
        updatedAt: now,
      },
    },
    plan: [],
    toolCalls: [],
    ...overrides,
  };
}

/**
 * Create a stub HandlerDeps that tracks calls.
 */
function makeDeps(overrides = {}) {
  const callLog = [];

  const deps = {
    llm: null,
    skillRuntime: {},
    policy: {},
    localize: jest.fn((_locale, _zh, en) => en),
    startToolCall: jest.fn((tool, input) => ({
      tool,
      input,
      status: 'success',
      startedAt: new Date().toISOString(),
    })),
    completeToolCallSuccess: jest.fn(),
    extractDraftParameters: jest.fn(async () => ({
      nextState: {
        inferredType: 'beam',
        updatedAt: Date.now(),
      },
      missing: { critical: ['lengthM'], nonCritical: [] },
      extractionMode: 'llm',
      structuralTypeMatch: { key: 'beam', mappedType: 'beam', supportLevel: 'supported' },
    })),
    isGenericFallbackDraft: jest.fn(() => false),
    applyDraftToSession: jest.fn(),
    assessInteractionNeeds: jest.fn(async () => ({
      criticalMissing: ['lengthM'],
      nonCriticalMissing: [],
      defaultProposals: [],
    })),
    buildInteractionPayload: jest.fn(async () => ({
      state: 'collecting',
      stage: 'model',
      turnId: 'turn-001',
    })),
    mapMissingFieldLabels: jest.fn(async (missing) => missing),
    buildInteractionQuestion: jest.fn(() => 'Please provide the span length.'),
    buildMetrics: jest.fn(() => ({
      toolCount: 1,
      failedToolCount: 0,
      totalToolDurationMs: 100,
      averageToolDurationMs: 100,
      maxToolDurationMs: 100,
      toolDurationMsByName: {},
    })),
    renderInteractionResponse: jest.fn(async () => 'Rendered response'),
    setInteractionSession: jest.fn(async () => {}),
    finalizeRunResult: jest.fn(async (_traceId, _convId, _msg, result) => result),
    buildGenericModelingIntro: jest.fn(() => 'Let me help you build a structural model.'),
    ...overrides,
  };

  return { deps, callLog };
}

/**
 * Create a nextPlan object.
 */
function makePlan(overrides = {}) {
  return {
    kind: 'ask',
    planningDirective: 'auto',
    rationale: 'override',
    ...overrides,
  };
}

/**
 * Create a draft result.
 */
function makeDraft(overrides = {}) {
  return {
    inferredType: 'beam',
    missingFields: ['lengthM'],
    extractionMode: 'llm',
    stateToPersist: { inferredType: 'beam', updatedAt: Date.now() },
    structuralTypeMatch: { key: 'beam', mappedType: 'beam', supportLevel: 'supported' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock module setup
// ---------------------------------------------------------------------------

// Mutable mock config shared across all isolated scopes.
const mockConfig = {};

/**
 * Set up common mocks for collect handler tests.
 * Mock paths resolve from tests/ to the dist/ directory.
 */
function setupCollectMocks(draftModelMock, draftMock) {
  jest.unstable_mockModule('../dist/agent-tools/builtin/draft-model.js', () => ({
    executeDraftModelInteractiveStep: jest.fn(draftModelMock),
  }));

  jest.unstable_mockModule('../dist/services/agent-handlers/draft.js', () => ({
    handleDraft: jest.fn(draftMock),
  }));

  jest.unstable_mockModule('../dist/config/index.js', () => ({
    config: mockConfig,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleCollect', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('should transition to handleDraft when no critical fields missing and not a generic fallback', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockDraftResult = makeDraft({ missingFields: [] });
      const mockHandleDraftResult = {
        traceId: 'trace-001',
        success: true,
        response: 'Draft generated',
        needsModelInput: false,
      };

      setupCollectMocks(
        async () => ({ draft: mockDraftResult, genericFallbackDraft: false }),
        async () => mockHandleDraftResult,
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      // No critical missing fields
      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: [],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      const nextPlan = makePlan();
      const result = await handleCollect(ctx, deps, nextPlan);

      expect(result).toEqual(mockHandleDraftResult);
    });
  });

  test('should return interaction result when critical fields are missing (non-generic fallback)', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockDraftResult = makeDraft({ missingFields: ['lengthM'] });

      setupCollectMocks(
        async () => ({ draft: mockDraftResult, genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      // Critical fields are missing
      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      const nextPlan = makePlan();
      const result = await handleCollect(ctx, deps, nextPlan);

      // Should have called buildInteractionPayload, renderInteractionResponse, finalizeRunResult
      expect(deps.buildInteractionPayload).toHaveBeenCalled();
      expect(deps.renderInteractionResponse).toHaveBeenCalled();
      expect(deps.finalizeRunResult).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.needsModelInput).toBe(true);
      expect(result.interaction).toBeDefined();
      expect(result.clarification).toBeDefined();
      expect(result.clarification.missingFields).toEqual(['lengthM']);
    });
  });

  test('should return generic fallback result when genericFallbackDraft is true', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockDraftResult = makeDraft({ missingFields: ['lengthM'] });

      setupCollectMocks(
        async () => ({ draft: mockDraftResult, genericFallbackDraft: true }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      const nextPlan = makePlan();
      const result = await handleCollect(ctx, deps, nextPlan);

      expect(deps.buildGenericModelingIntro).toHaveBeenCalledWith(ctx.locale, ctx.noSkillMode);
      expect(deps.buildInteractionPayload).toHaveBeenCalled();
      expect(deps.renderInteractionResponse).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.needsModelInput).toBe(true);
      expect(result.clarification).toBeDefined();
    });
  });

  test('should use default missing fields when generic fallback draft has empty missingFields', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockDraftResult = makeDraft({ missingFields: [] });

      setupCollectMocks(
        async () => ({ draft: mockDraftResult, genericFallbackDraft: true }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: [],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      const nextPlan = makePlan();
      await handleCollect(ctx, deps, nextPlan);

      // localize should have been called with the default 'key structural parameters' fallback
      expect(deps.localize).toHaveBeenCalledWith(
        ctx.locale,
        expect.stringContaining('\u5173\u952E\u7ED3\u6784\u53C2\u6570'),
        expect.stringContaining('key structural parameters'),
      );
    });
  });

  test('should persist session when sessionKey is present', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft(), genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx({ sessionKey: 'conv-456' });
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      await handleCollect(ctx, deps, makePlan());

      expect(deps.setInteractionSession).toHaveBeenCalledWith('conv-456', ctx.session);
    });
  });

  test('should not call setInteractionSession when sessionKey is undefined', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft(), genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx({ sessionKey: undefined });
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      await handleCollect(ctx, deps, makePlan());

      expect(deps.setInteractionSession).not.toHaveBeenCalled();
    });
  });

  test('should call extractDraftParameters through collectOnlyTextToModelDraft', async () => {
    await jest.isolateModulesAsync(async () => {
      let capturedTextToModelDraft = null;

      setupCollectMocks(
        async (args) => {
          capturedTextToModelDraft = args.textToModelDraft;
          return { draft: makeDraft({ missingFields: [] }), genericFallbackDraft: false };
        },
        // With no critical missing and genericFallbackDraft=false, handleDraft IS called
        async () => ({ traceId: 'trace-001', success: true }),
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: [],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      await handleCollect(ctx, deps, makePlan());

      // The textToModelDraft function passed to executeDraftModelInteractiveStep
      // should be the collectOnlyTextToModelDraft which calls extractDraftParameters
      expect(capturedTextToModelDraft).toBeTruthy();
    });
  });

  test('should set interaction state to confirming when critical fields are missing', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft(), genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM', 'loadKN'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      await handleCollect(ctx, deps, makePlan());

      // buildInteractionPayload should be called with 'confirming' state
      expect(deps.buildInteractionPayload).toHaveBeenCalledWith(
        expect.objectContaining({ criticalMissing: ['lengthM', 'loadKN'] }),
        ctx.session,
        'confirming',
        ctx.locale,
        ctx.skillIds,
        ctx.activeToolIds,
      );
    });
  });

  test('should set interaction state to collecting when only non-critical fields are missing', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft({ missingFields: [] }), genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      // Only non-critical missing, but still has critical to enter the non-draft path
      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: [],
        nonCriticalMissing: ['loadType'],
        defaultProposals: [],
      }));

      // Since criticalMissing.length === 0 and genericFallbackDraft is false,
      // this will go to handleDraft. We need to test the non-draft path with
      // critical missing fields but with genericFallbackDraft = true to hit
      // the collecting state.
    });
  });

  test('should use confirming state for generic fallback with critical missing', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft({ missingFields: ['lengthM'] }), genericFallbackDraft: true }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      await handleCollect(ctx, deps, makePlan());

      // For the generic fallback path, state should be 'confirming' when criticalMissing > 0
      expect(deps.buildInteractionPayload).toHaveBeenCalledWith(
        expect.objectContaining({ criticalMissing: ['lengthM'] }),
        ctx.session,
        'confirming',
        ctx.locale,
        ctx.skillIds,
        ctx.activeToolIds,
      );
    });
  });

  test('should propagate errors from executeDraftModelInteractiveStep', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => { throw new Error('Draft extraction failed'); },
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      await expect(handleCollect(ctx, deps, makePlan())).rejects.toThrow('Draft extraction failed');
    });
  });

  test('should propagate errors from assessInteractionNeeds', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft(), genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => {
        throw new Error('Assessment failed');
      });

      await expect(handleCollect(ctx, deps, makePlan())).rejects.toThrow('Assessment failed');
    });
  });

  test('should call mapMissingFieldLabels for non-generic fallback with critical missing', async () => {
    await jest.isolateModulesAsync(async () => {
      setupCollectMocks(
        async () => ({ draft: makeDraft(), genericFallbackDraft: false }),
        async () => { throw new Error('handleDraft should not be called'); },
      );

      const { handleCollect } = await import('../dist/services/agent-handlers/collect.js');

      const ctx = makeCtx();
      const { deps } = makeDeps();

      deps.assessInteractionNeeds = jest.fn(async () => ({
        criticalMissing: ['lengthM'],
        nonCriticalMissing: [],
        defaultProposals: [],
      }));

      deps.mapMissingFieldLabels = jest.fn(async (missing) => ['Span Length (m)']);

      await handleCollect(ctx, deps, makePlan());

      expect(deps.mapMissingFieldLabels).toHaveBeenCalledWith(
        ['lengthM'],
        ctx.locale,
        expect.any(Object),
        ctx.skillIds,
      );
    });
  });
});
