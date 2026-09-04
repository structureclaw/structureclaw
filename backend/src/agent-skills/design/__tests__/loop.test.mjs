import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_DESIGN_MAX_ITERATIONS,
  buildDesignLoopStopResult,
  buildSkillDesignResultFromProvider,
  createEmptyDesignLoopState,
  extractCodeCheckStats,
  isDesignConverged,
  isDesignLoopExhausted,
  markDesignLoopStopped,
  nextDesignIteration,
  reduceDesignIteration,
  summarizeDesignChanges,
} from '../../../../dist/agent-skills/design/loop.js';

function codeCheckWith(total, failed, maxUtilization) {
  return {
    summary: { total, passed: total - failed, failed, maxUtilization },
  };
}

function providerResultWithChanges(changes) {
  return {
    provider: 'local-rule',
    changes,
    model: { schema_version: '2.0.0', sections: [{ id: '1', name: 'HW250X250' }] },
    maxUtilizationBefore: 1.25,
    maxUtilizationAfter: 0.95,
    notes: [],
  };
}

const CHANGE = {
  sectionId: '1',
  elementIds: ['C1'],
  before: 'HW200X200',
  after: 'HW250X250',
  utilizationBefore: 1.25,
  utilizationAfter: 0.95,
  reason: 'utilization exceeded 1.0',
};

describe('design loop state machine', () => {
  test('default max iterations is 10', () => {
    expect(DEFAULT_DESIGN_MAX_ITERATIONS).toBe(10);
    expect(createEmptyDesignLoopState().maxIterations).toBe(10);
  });

  test('convergence requires a non-empty passing code check', () => {
    expect(isDesignConverged(codeCheckWith(6, 0, 0.8))).toBe(true);
    expect(isDesignConverged(codeCheckWith(6, 2, 1.4))).toBe(false);
    expect(isDesignConverged(undefined)).toBe(false);
    expect(isDesignConverged({})).toBe(false);
  });

  test('extractCodeCheckStats normalizes summary counts', () => {
    expect(extractCodeCheckStats(codeCheckWith(6, 2, 1.4))).toEqual({
      total: 6, passed: 4, failed: 2, maxUtilization: 1.4,
    });
    expect(extractCodeCheckStats(null)).toEqual({ total: 0, passed: 0, failed: 0 });
    expect(extractCodeCheckStats({ summary: { total: 'x', failed: -1 } })).toEqual({
      total: 0, passed: 0, failed: 0,
    });
  });

  test('max-iteration guard blocks only after max recorded iterations', () => {
    let state = createEmptyDesignLoopState(3);
    expect(isDesignLoopExhausted(state)).toBe(false);
    state = reduceDesignIteration(state, buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 1,
      maxIterations: 3,
      approved: true,
    }));
    expect(isDesignLoopExhausted(state)).toBe(false);
    state = reduceDesignIteration(state, buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 2,
      maxIterations: 3,
      approved: true,
    }));
    state = reduceDesignIteration(state, buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 3,
      maxIterations: 3,
      approved: true,
    }));
    expect(isDesignLoopExhausted(state)).toBe(true);
    expect(nextDesignIteration(state)).toBe(4);
  });

  test('reduceDesignIteration appends immutably and tracks convergence', () => {
    const previous = createEmptyDesignLoopState(10);
    const snapshot = JSON.stringify(previous);
    const result = buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 1,
      maxIterations: 10,
      approved: true,
    });
    const next = reduceDesignIteration(previous, result);
    expect(JSON.stringify(previous)).toBe(snapshot);
    expect(next.iterations).toHaveLength(1);
    expect(next.iterations[0].applied).toBe(true);
    expect(next.iterations[0].provider).toBe('local-rule');
    expect(next.lastAction).toBe('iterate');
    expect(next.converged).toBe(false);
    expect(next.updatedAt).toBeTruthy();
  });

  test('markDesignLoopStopped does not consume an iteration slot', () => {
    let state = createEmptyDesignLoopState(10);
    state = reduceDesignIteration(state, buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 1,
      maxIterations: 10,
      approved: true,
    }));
    const stopped = markDesignLoopStopped(state, 'max_iterations_reached');
    expect(stopped.iterations).toHaveLength(1);
    expect(stopped.lastAction).toBe('max_iterations_reached');
    expect(stopped.converged).toBe(false);

    const converged = markDesignLoopStopped(state, 'converged');
    expect(converged.iterations).toHaveLength(1);
    expect(converged.converged).toBe(true);
    expect(converged.lastAction).toBe('converged');
  });

  test('provider result wrapping applies approval gating', () => {
    const approved = buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 1,
      maxIterations: 10,
      approved: true,
    });
    expect(appliedShape(approved)).toEqual({ applied: true, action: 'iterate' });
    expect(approved.model).toBeDefined();
    expect(approved.provider).toBe('local-rule');

    const unapproved = buildSkillDesignResultFromProvider({
      providerResult: providerResultWithChanges([CHANGE]),
      iteration: 1,
      maxIterations: 10,
      approved: false,
    });
    expect(appliedShape(unapproved)).toEqual({ applied: false, action: 'blocked_approval' });
    expect(unapproved.model).toBeUndefined();

    const noChange = buildSkillDesignResultFromProvider({
      providerResult: { provider: 'local-rule', changes: [], model: {}, notes: [] },
      iteration: 2,
      maxIterations: 10,
      approved: true,
    });
    expect(appliedShape(noChange)).toEqual({ applied: false, action: 'no_change' });
    expect(noChange.model).toBeUndefined();

    function appliedShape(result) {
      return { applied: result.applied, action: result.action };
    }
  });

  test('stop results are bilingual and never applied', () => {
    const converged = buildDesignLoopStopResult({
      action: 'converged', iteration: 2, maxIterations: 10,
    });
    expect(converged.converged).toBe(true);
    expect(converged.applied).toBe(false);
    expect(converged.changes).toEqual([]);
    expect(converged.summary.zh).toContain('收敛');
    expect(converged.summary.en).toContain('converged');

    const guarded = buildDesignLoopStopResult({
      action: 'max_iterations_reached', iteration: 11, maxIterations: 10,
    });
    expect(guarded.converged).toBe(false);
    expect(guarded.summary.en).toContain('10');
    expect(guarded.summary.zh).toContain('10');
  });

  test('summarizeDesignChanges localizes one and many changes', () => {
    expect(summarizeDesignChanges([CHANGE], 'en')).toContain('HW200X200 → HW250X250');
    expect(summarizeDesignChanges([CHANGE, CHANGE], 'zh')).toContain('2 处截面调整');
    expect(summarizeDesignChanges([], 'en')).toContain('No design changes');
  });
});
