import { describe, expect, test } from '@jest/globals';
import { resolveInteractivePlanKind, parsePlannerResponse, extractJsonObject, planNextStep } from '../../../dist/services/agent-router.js';

describe('agent router target artifact planning', () => {
  const mockAssessInteractionNeeds = async () => ({
    criticalMissing: [],
    nonCriticalMissing: [],
    defaultProposals: [],
  });
  const mockHasEmptySkillSelection = () => false;
  const mockHasActiveTool = () => true;

  test('returns a report target when user asks for a report', async () => {
    const plan = await resolveInteractivePlanKind(
      {
        locale: 'zh',
        skillIds: ['report-export-builtin'],
        hasModel: true,
        activeToolIds: new Set(['generate_report']),
        session: {
          resolved: { includeReport: true },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
      mockHasActiveTool,
    );

    expect(plan.targetArtifact).toBe('reportArtifact');
  });

  test('returns analysisRaw target when user asks to analyze', async () => {
    const plan = await resolveInteractivePlanKind(
      {
        locale: 'zh',
        skillIds: ['analysis-opensees-static'],
        hasModel: true,
        activeToolIds: new Set(['run_analysis']),
        session: {
          resolved: { analysisType: 'static' },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
      mockHasActiveTool,
    );

    expect(plan.targetArtifact).toBe('analysisRaw');
  });

  test('returns codeCheckResult target when design code resolved', async () => {
    const plan = await resolveInteractivePlanKind(
      {
        locale: 'zh',
        skillIds: ['code-check-gb50017'],
        hasModel: true,
        activeToolIds: new Set(['run_code_check']),
        session: {
          resolved: { designCode: 'GB50017' },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
      mockHasActiveTool,
    );

    expect(plan.targetArtifact).toBe('codeCheckResult');
  });

  test('returns normalizedModel target when no model exists', async () => {
    const plan = await resolveInteractivePlanKind(
      {
        locale: 'zh',
        skillIds: ['frame'],
        hasModel: false,
        activeToolIds: new Set(['draft_model']),
        session: {
          draft: { inferredType: 'frame' },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
      mockHasActiveTool,
    );

    expect(plan.kind).toBe('ask');
  });
});

describe('parsePlannerResponse', () => {
  test('extracts execute kind with targetArtifact', () => {
    const result = parsePlannerResponse(
      '{"kind":"execute","replyMode":null,"targetArtifact":"analysisRaw","reason":"user wants analysis"}',
      ['reply', 'ask', 'execute'],
    );
    expect(result).not.toBeNull();
    expect(result.kind).toBe('execute');
    expect(result.targetArtifact).toBe('analysisRaw');
  });

  test('extracts execute kind with codeCheckResult targetArtifact', () => {
    const result = parsePlannerResponse(
      '{"kind":"execute","replyMode":null,"targetArtifact":"codeCheckResult","reason":"code check requested"}',
      ['reply', 'ask', 'execute'],
    );
    expect(result).not.toBeNull();
    expect(result.kind).toBe('execute');
    expect(result.targetArtifact).toBe('codeCheckResult');
  });

  test('extracts execute kind with normalizedModel targetArtifact', () => {
    const result = parsePlannerResponse(
      '{"kind":"execute","targetArtifact":"normalizedModel","reason":"model update"}',
      ['reply', 'ask', 'execute'],
    );
    expect(result).not.toBeNull();
    expect(result.kind).toBe('execute');
    expect(result.targetArtifact).toBe('normalizedModel');
  });

  test('extracts reply kind without targetArtifact', () => {
    const result = parsePlannerResponse(
      '{"kind":"reply","replyMode":"plain","targetArtifact":null,"reason":"casual chat"}',
      ['reply', 'ask', 'execute'],
    );
    expect(result).not.toBeNull();
    expect(result.kind).toBe('reply');
    expect(result.replyMode).toBe('plain');
    expect(result.targetArtifact).toBeUndefined();
  });

  test('extracts ask kind from nested decision wrapper', () => {
    const result = parsePlannerResponse(
      '{"decision":{"kind":"ask","replyMode":null,"targetArtifact":null,"reason":"missing info"}}',
      ['reply', 'ask', 'execute'],
    );
    expect(result).not.toBeNull();
    expect(result.kind).toBe('ask');
  });

  test('rejects tool_call kind when not in allowedKinds', () => {
    const result = parsePlannerResponse(
      '{"kind":"tool_call","replyMode":null,"targetArtifact":"analysisRaw","reason":"legacy"}',
      ['reply', 'ask', 'execute'],
    );
    expect(result).toBeNull();
  });

  test('extracts from fenced json block', () => {
    const result = parsePlannerResponse(
      '```json\n{"kind":"execute","targetArtifact":"reportArtifact","reason":"report"}\n```',
      ['reply', 'ask', 'execute'],
    );
    expect(result).not.toBeNull();
    expect(result.kind).toBe('execute');
    expect(result.targetArtifact).toBe('reportArtifact');
  });
});

describe('planNextStep force_tool path', () => {
  const mockAssessInteractionNeeds = async () => ({
    criticalMissing: [],
    nonCriticalMissing: [],
    defaultProposals: [],
  });
  const mockHasEmptySkillSelection = () => false;

  test('returns execute with targetArtifact for force_tool directive', async () => {
    const plan = await planNextStep(
      null,
      '分析这个结构',
      {
        planningDirective: 'force_tool',
        allowToolCall: true,
        locale: 'zh',
        skillIds: ['frame'],
        hasModel: true,
        session: {
          resolved: { analysisType: 'static' },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
    );
    expect(plan.kind).toBe('execute');
    expect(plan.targetArtifact).toBe('analysisRaw');
  });

  test('keeps force_tool on analysisRaw when autoCodeCheck and report are explicitly disabled', async () => {
    const plan = await planNextStep(
      null,
      '分析这个结构',
      {
        planningDirective: 'force_tool',
        allowToolCall: true,
        locale: 'zh',
        skillIds: ['frame', 'code-check-gb50017', 'report-export-builtin'],
        hasModel: true,
        activeToolIds: new Set(['run_analysis', 'run_code_check', 'generate_report']),
        session: {
          resolved: {
            analysisType: 'static',
            autoCodeCheck: false,
            includeReport: false,
          },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
    );
    expect(plan.kind).toBe('execute');
    expect(plan.targetArtifact).toBe('analysisRaw');
  });

  test('force_tool targets normalizedModel when hasModel is false even with forceExecution', async () => {
    const plan = await planNextStep(
      null,
      '设计一个简支梁',
      {
        planningDirective: 'force_tool',
        allowToolCall: true,
        locale: 'zh',
        skillIds: ['generic'],
        hasModel: false,
        activeToolIds: new Set(['draft_model']),
        session: {
          draft: { inferredType: 'beam' },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
    );
    expect(plan.kind).toBe('execute');
    expect(plan.targetArtifact).toBe('normalizedModel');
  });

  test('force_tool falls back to analysisRaw when run_code_check is not in activeToolIds', async () => {
    const plan = await planNextStep(
      null,
      '静力分析并规范校核',
      {
        planningDirective: 'force_tool',
        allowToolCall: true,
        locale: 'zh',
        skillIds: ['code-check-gb50017'],
        hasModel: true,
        activeToolIds: new Set(['run_analysis']),
        session: {
          resolved: {
            autoCodeCheck: true,
            designCode: 'GB50017',
          },
          updatedAt: Date.now(),
        },
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
    );
    expect(plan.kind).toBe('execute');
    expect(plan.targetArtifact).toBe('analysisRaw');
  });

  test('returns execute with targetArtifact via LLM when allowed', async () => {
    const mockLlm = {
      invoke: async () => ({
        content: '{"kind":"execute","replyMode":null,"targetArtifact":"analysisRaw","reason":"analysis requested"}',
      }),
    };
    const plan = await planNextStep(
      mockLlm,
      '简支梁6米，均布荷载20kN/m，请进行静力分析',
      {
        planningDirective: 'auto',
        allowToolCall: true,
        locale: 'zh',
        skillIds: ['beam'],
        hasModel: true,
        activeToolIds: new Set(['run_analysis']),
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
    );
    expect(plan.kind).toBe('execute');
    expect(plan.targetArtifact).toBe('analysisRaw');
  });

  test('upgrades normalizedModel target to analysisRaw for concrete design requests when analysis is available', async () => {
    const mockLlm = {
      invoke: async () => ({
        content: '{"kind":"execute","replyMode":null,"targetArtifact":"normalizedModel","reason":"design requested"}',
      }),
    };
    const plan = await planNextStep(
      mockLlm,
      '设计一个简支梁，跨度10m，梁中间荷载1kN',
      {
        planningDirective: 'auto',
        allowToolCall: true,
        locale: 'zh',
        skillIds: ['beam'],
        hasModel: false,
        activeToolIds: new Set(['draft_model', 'validate_model', 'run_analysis']),
      },
      mockAssessInteractionNeeds,
      mockHasEmptySkillSelection,
    );
    expect(plan.kind).toBe('execute');
    expect(plan.targetArtifact).toBe('analysisRaw');
  });
});
