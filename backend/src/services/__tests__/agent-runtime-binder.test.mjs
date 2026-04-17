import { describe, expect, test } from '@jest/globals';
import { AgentRuntimeBinder } from '../../../dist/services/agent-runtime-binder.js';
import { AgentPolicyService } from '../../../dist/services/agent-policy.js';

describe('agent runtime binder', () => {
  test('does not auto-activate an analysis provider when no binding exists (provider-first path)', async () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => ({ id: 'analysis-static' }),
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );

    const active = await binder.resolveActiveDomainSkillIds({
      selectedSkillIds: [],
      providerBindings: {},
      workingSession: { updatedAt: 0 },
      message: '开始分析',
      context: {},
    });

    expect(active).toEqual([]);
  });

  test('does not auto-add report-export without selection or an explicit scheduled step (provider-first path)', async () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => ({ id: 'analysis-static' }),
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );

    const active = await binder.resolveActiveDomainSkillIds({
      selectedSkillIds: [],
      providerBindings: {},
      workingSession: { updatedAt: 0 },
      message: '开始分析',
      context: { includeReport: true },
    });

    expect(active).toEqual([]);
  });

  test('blocks when multiple selected provider candidates match the same slot without an explicit binding', async () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => ([
          { id: 'analysis-a', runtimeContract: { role: 'provider', providerSlot: 'analysisProvider' } },
          { id: 'analysis-b', runtimeContract: { role: 'provider', providerSlot: 'analysisProvider' } },
        ]),
        resolvePreferredAnalysisSkill: () => ({ id: 'analysis-a' }),
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );

    const resolution = await binder.resolveProviderBindingRequirements({
      selectedSkillIds: ['analysis-a', 'analysis-b'],
      requiredSlots: ['analysisProvider'],
      bindings: {},
    });

    expect(resolution.blockedReason).toMatch(/analysisProvider/);
  });

  // --- Provider-first path (Phase 4 scheduler path) ---

  test('provider-first path only returns selected + bound skills when providerBindings is passed', async () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => ({ id: 'analysis-static' }),
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );

    // When providerBindings is explicitly provided (even as {}), the new path activates
    const active = await binder.resolveActiveDomainSkillIds({
      selectedSkillIds: ['my-skill'],
      providerBindings: { analysisProviderSkillId: 'analysis-opensees-static' },
      workingSession: { updatedAt: 0 },
      message: '开始分析',
      context: {},
    });

    // Only selected + bound skills, no auto-activation
    expect(active).toEqual(['analysis-opensees-static', 'my-skill']);
  });

  test('provider-first path returns empty when no selection and no bindings', async () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => ({ id: 'analysis-static' }),
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );

    const active = await binder.resolveActiveDomainSkillIds({
      selectedSkillIds: [],
      providerBindings: {},
      workingSession: { updatedAt: 0 },
      message: '开始分析',
      context: {},
    });

    expect(active).toEqual([]);
  });

  test('legacy auto-activation adds analysis capability for natural structural design requests', async () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => ({ id: 'analysis-static' }),
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      new AgentPolicyService(),
    );

    const active = await binder.resolveActiveDomainSkillIds({
      selectedSkillIds: [],
      workingSession: { updatedAt: 0 },
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
      context: { includeReport: false },
    });

    expect(active).toEqual(['analysis-static', 'validation-structure-model']);
  });

  // --- assertStepAuthorization ---

  test('assertStepAuthorized allows step with no skillId', () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => undefined,
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );
    expect(() => binder.assertStepAuthorized({
      step: { stepId: 'test', role: 'transformer', tool: 'postprocess_result', consumes: [], provides: 'postprocessedResult', mode: 'execute', reason: 'test' },
      selectedSkillIds: ['skill-a'],
      bindings: {},
    })).not.toThrow();
  });

  test('assertStepAuthorized throws when step skillId not in selected set', () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => undefined,
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );
    expect(() => binder.assertStepAuthorized({
      step: { stepId: 'test', role: 'consumer', tool: 'generate_report', consumes: [], provides: 'reportArtifact', mode: 'execute', reason: 'test', skillId: 'unknown-skill' },
      selectedSkillIds: ['skill-a', 'skill-b'],
      bindings: {},
    })).toThrow('skill not in selected skill set');
  });

  test('assertStepAuthorized allows step when skillId is in selected set', () => {
    const binder = new AgentRuntimeBinder(
      {
        listSkillManifests: async () => [],
        resolvePreferredAnalysisSkill: () => undefined,
        resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
        resolveCodeCheckSkillId: () => undefined,
        resolveSkillTooling: async () => ({ tools: [], skillIdsByToolId: {} }),
        listBuiltinToolManifests: () => [],
      },
      {
        inferExecutionIntent: () => true,
        inferProceedIntent: () => false,
      },
    );
    expect(() => binder.assertStepAuthorized({
      step: { stepId: 'test', role: 'consumer', tool: 'generate_report', consumes: [], provides: 'reportArtifact', mode: 'execute', reason: 'test', skillId: 'skill-a' },
      selectedSkillIds: ['skill-a', 'skill-b'],
      bindings: {},
    })).not.toThrow();
  });
});
