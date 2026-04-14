import { describe, expect, test } from '@jest/globals';
import { resolveInteractivePlanKind } from '../../../dist/services/agent-router.js';

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
});
