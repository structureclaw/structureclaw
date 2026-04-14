import { describe, expect, test } from '@jest/globals';
import { AgentRuntimeBinder } from '../../../dist/services/agent-runtime-binder.js';

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
});
