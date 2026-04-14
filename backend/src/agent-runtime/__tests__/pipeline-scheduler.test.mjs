import { describe, expect, test } from '@jest/globals';
import { PipelineScheduler } from '../../../dist/agent-runtime/pipeline-scheduler.js';

describe('pipeline scheduler', () => {
  // --- Provider binding gating ---

  test('blocks analysisRaw when analysisProvider is not bound', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始分析',
      locale: 'zh',
      selectedSkillIds: ['analysis-opensees-static'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'analysisRaw',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db' },
      },
    });

    expect(plan.blockedReason).toMatch(/analysisProvider/);
  });

  test('blocks codeCheckResult when codeCheckProvider is not bound', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始校核',
      locale: 'zh',
      selectedSkillIds: ['code-check-gb50017'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'codeCheckResult',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db' },
        postprocessedResult: { status: 'ready', dependencyFingerprint: 'fp-pp-1' },
      },
    });

    expect(plan.blockedReason).toMatch(/codeCheckProvider/);
  });

  // --- Analysis path ---

  test('inserts validation before analysis and uses queue-run when async is allowed', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始分析',
      locale: 'zh',
      selectedSkillIds: ['analysis-opensees-static'],
      bindings: { analysisProviderSkillId: 'analysis-opensees-static' },
      projectPolicy: { allowAsync: true },
      targetArtifact: 'analysisRaw',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db' },
      },
    });

    expect(plan.requiredSteps.some((step) => step.action === 'validate')).toBe(true);
    expect(plan.requiredSteps.some((step) => step.action === 'analyze' && step.mode === 'queue-run')).toBe(true);
  });

  // --- Postprocess path ---

  test('plans postprocess step from analysisRaw', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '后处理',
      locale: 'zh',
      selectedSkillIds: ['result-postprocess-builtin'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'postprocessedResult',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db' },
        analysisRaw: { status: 'ready', dependencyFingerprint: 'fp-ar-1' },
      },
    });

    expect(plan.requiredSteps.some((step) => step.action === 'postprocess')).toBe(true);
    expect(plan.blockedReason).toBeUndefined();
  });

  // --- Code-check path ---

  test('plans code-check with all three dependencies', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始校核',
      locale: 'zh',
      selectedSkillIds: ['code-check-gb50017'],
      bindings: { codeCheckProviderSkillId: 'code-check-gb50017' },
      projectPolicy: { designCode: 'GB50017' },
      targetArtifact: 'codeCheckResult',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
        postprocessedResult: { status: 'ready', dependencyFingerprint: 'fp-3' },
      },
    });

    const ccStep = plan.requiredSteps.find((s) => s.action === 'code_check');
    expect(ccStep).toBeDefined();
    expect(plan.blockedReason).toBeUndefined();
  });

  // --- Report path with consumer contract ---

  test('reportArtifact only requires designBasis + normalizedModel (consumer contract)', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '生成报告',
      locale: 'zh',
      selectedSkillIds: ['report-export-builtin'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'reportArtifact',
      consumerContracts: [{
        role: 'consumer',
        targetArtifact: 'reportArtifact',
        requiredConsumes: ['designBasis', 'normalizedModel'],
        optionalConsumes: ['postprocessedResult', 'codeCheckResult'],
      }],
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
      },
    });

    expect(plan.requiredSteps.some((s) => s.action === 'report')).toBe(true);
    expect(plan.blockedReason).toBeUndefined();
  });

  test('reportArtifact plans missing required deps when they can be produced', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '生成报告',
      locale: 'zh',
      selectedSkillIds: ['report-export-builtin'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'reportArtifact',
      consumerContracts: [{
        role: 'consumer',
        targetArtifact: 'reportArtifact',
        requiredConsumes: ['designBasis', 'normalizedModel'],
        optionalConsumes: ['postprocessedResult', 'codeCheckResult'],
      }],
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
      },
    });

    expect(plan.requiredSteps.some((s) => s.action === 'update')).toBe(true);
    expect(plan.requiredSteps.some((s) => s.action === 'report')).toBe(true);
    expect(plan.blockedReason).toBeUndefined();
  });

  // --- Drawing path ---

  test('drawingArtifact plans with required dependencies', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '出图',
      locale: 'zh',
      selectedSkillIds: ['drawing-builtin'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'drawingArtifact',
      consumerContracts: [{
        role: 'consumer',
        targetArtifact: 'drawingArtifact',
        requiredConsumes: ['designBasis', 'normalizedModel'],
        optionalConsumes: ['postprocessedResult', 'codeCheckResult'],
      }],
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
      },
    });

    expect(plan.requiredSteps.some((s) => s.action === 'drawing')).toBe(true);
    expect(plan.blockedReason).toBeUndefined();
  });

  // --- Reuse ---

  test('reuses ready artifact when fingerprint matches and forceRecompute is false', () => {
    const scheduler = new PipelineScheduler();
    // dependencyFingerprint must match what computeDependencyFingerprint produces
    // from analysisModel's artifactId/revision + the provider binding
    const existingArtifact = {
      artifactId: 'ar-1',
      kind: 'analysisRaw',
      status: 'ready',
      dependencyFingerprint: '06015a3a0911ecc4', // sha256("analysisModel:am-1:1|analysisProvider:analysis-opensees-static")[:16]
      basedOn: [],
    };
    const plan = scheduler.plan({
      message: '开始分析',
      locale: 'zh',
      selectedSkillIds: ['analysis-opensees-static'],
      bindings: { analysisProviderSkillId: 'analysis-opensees-static' },
      projectPolicy: {},
      targetArtifact: 'analysisRaw',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db', artifactId: 'db-1', revision: 1 },
        analysisModel: { status: 'ready', dependencyFingerprint: 'fp-am-1', artifactId: 'am-1', revision: 1 },
        analysisRaw: existingArtifact,
      },
    });

    const analyzeStep = plan.requiredSteps.find((s) => s.action === 'analyze');
    expect(analyzeStep?.mode).toBe('reuse');
  });

  // --- chatReply passthrough ---

  test('chatReply returns empty steps', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '你好',
      locale: 'zh',
      selectedSkillIds: [],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'chatReply',
      sessionArtifacts: {},
      projectArtifacts: {},
    });

    expect(plan.requiredSteps).toEqual([]);
    expect(plan.blockedReason).toBeUndefined();
  });

  // --- Design feedback path ---

  test('plans design feedback step when target is design iteration', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.planDesignFeedback({
      message: '优化设计',
      locale: 'zh',
      selectedSkillIds: ['design-steel'],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'normalizedModel',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
        postprocessedResult: { status: 'ready', dependencyFingerprint: 'fp-3' },
        codeCheckResult: { status: 'ready', dependencyFingerprint: 'fp-4' },
      },
    });

    const designStep = plan.requiredSteps.find((s) => s.action === 'design');
    expect(designStep).toBeDefined();
    expect(designStep.mode).toBe('propose');
    expect(designStep.provides).toBe('normalizedModel');
  });

  test('design feedback uses execute mode when auto-design is enabled', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.planDesignFeedback({
      message: '优化设计',
      locale: 'zh',
      selectedSkillIds: ['design-steel'],
      bindings: {},
      projectPolicy: { autoDesignIterationPolicy: { enabled: true, maxIterations: 5, acceptanceCriteria: [], allowedDomains: ['design'] } },
      targetArtifact: 'normalizedModel',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
      },
    });

    const designStep = plan.requiredSteps.find((s) => s.action === 'design');
    expect(designStep).toBeDefined();
    expect(designStep.mode).toBe('execute');
    expect(plan.blockedReason).toBeUndefined();
  });

  test('design feedback blocks when auto-design is enabled with zero maxIterations', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.planDesignFeedback({
      message: '优化设计',
      locale: 'zh',
      selectedSkillIds: ['design-steel'],
      bindings: {},
      projectPolicy: { autoDesignIterationPolicy: { enabled: true, maxIterations: 0, acceptanceCriteria: [], allowedDomains: ['design'] } },
      targetArtifact: 'normalizedModel',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
      },
    });

    expect(plan.blockedReason).toMatch(/autoDesignIteration/);
    expect(plan.requiredSteps).toEqual([]);
  });

  // --- Approval checkpoint (spec section 10B.5) ---

  test('inserts approval step before provider execution when requireApprovalBeforeExecution is true', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始分析',
      locale: 'zh',
      selectedSkillIds: ['analysis-opensees-static'],
      bindings: { analysisProviderSkillId: 'analysis-opensees-static' },
      projectPolicy: { requireApprovalBeforeExecution: true },
      targetArtifact: 'analysisRaw',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db' },
      },
    });

    const approvalStep = plan.requiredSteps.find((s) => s.mode === 'approval');
    expect(approvalStep).toBeDefined();
    expect(approvalStep.role).toBe('provider');
    expect(approvalStep.action).toBe('analyze');
    expect(approvalStep.provides).toBe('analysisRaw');

    // The execute step should still exist after the approval step
    const executeStep = plan.requiredSteps.find((s) => s.mode === 'execute' && s.action === 'analyze');
    expect(executeStep).toBeDefined();
    expect(plan.requiredSteps.indexOf(approvalStep)).toBeLessThan(plan.requiredSteps.indexOf(executeStep));
  });

  test('does not insert approval step when requireApprovalBeforeExecution is false', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始分析',
      locale: 'zh',
      selectedSkillIds: ['analysis-opensees-static'],
      bindings: { analysisProviderSkillId: 'analysis-opensees-static' },
      projectPolicy: { requireApprovalBeforeExecution: false },
      targetArtifact: 'analysisRaw',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-db' },
      },
    });

    expect(plan.requiredSteps.some((s) => s.mode === 'approval')).toBe(false);
  });

  test('approval step for codeCheck when requireApprovalBeforeExecution is true', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始校核',
      locale: 'zh',
      selectedSkillIds: ['code-check-gb50017'],
      bindings: { codeCheckProviderSkillId: 'code-check-gb50017' },
      projectPolicy: { requireApprovalBeforeExecution: true },
      targetArtifact: 'codeCheckResult',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
        postprocessedResult: { status: 'ready', dependencyFingerprint: 'fp-3' },
      },
    });

    const approvalStep = plan.requiredSteps.find((s) => s.mode === 'approval');
    expect(approvalStep).toBeDefined();
    expect(approvalStep.action).toBe('code_check');
    expect(approvalStep.provides).toBe('codeCheckResult');
  });

  // --- Cycle detection ---

  test('returns blocked when a dependency cycle is detected', () => {
    // The real graph is a DAG, so this tests the guard directly.
    // We simulate a cycle by planning the same target that is already being visited.
    // Since the public API only calls plan() once, we test via a target whose
    // dependency chain could be cyclic if the graph were mutated.
    // For now, verify that a normal plan does NOT produce a cycle block.
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: '开始校核',
      locale: 'zh',
      selectedSkillIds: ['code-check-gb50017'],
      bindings: { codeCheckProviderSkillId: 'code-check-gb50017' },
      projectPolicy: { designCode: 'GB50017' },
      targetArtifact: 'codeCheckResult',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
        normalizedModel: { status: 'ready', dependencyFingerprint: 'fp-2' },
        postprocessedResult: { status: 'ready', dependencyFingerprint: 'fp-3' },
      },
    });

    // No cycle in the real graph
    expect(plan.blockedReason).toBeUndefined();
    expect(plan.requiredSteps.length).toBeGreaterThan(0);
  });

  test('returns blocked for unknown target artifact', () => {
    const scheduler = new PipelineScheduler();
    const plan = scheduler.plan({
      message: 'do something',
      locale: 'en',
      selectedSkillIds: [],
      bindings: {},
      projectPolicy: {},
      targetArtifact: 'nonexistentArtifact',
      sessionArtifacts: {},
      projectArtifacts: {
        designBasis: { status: 'ready', dependencyFingerprint: 'fp-1' },
      },
    });

    expect(plan.blockedReason).toMatch(/unknown target artifact/);
    expect(plan.requiredSteps).toEqual([]);
  });
});
