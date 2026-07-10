import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { prisma } from '../dist/utils/database.js';
import {
  AnalysisService,
  buildDirectAnalysisModelForCodeCheck,
  buildDirectSeismicReport,
  resolveDirectChinaSeismicDesignCode,
  shouldRunDirectSeismicCodeCheck,
} from '../dist/services/analysis.js';

const originalFindUnique = prisma.analysis.findUnique;
const originalUpdate = prisma.analysis.update;

afterEach(() => {
  prisma.analysis.findUnique = originalFindUnique;
  prisma.analysis.update = originalUpdate;
  jest.restoreAllMocks();
});

describe('AnalysisService direct China seismic workflow', () => {
  test('detects when direct seismic analysis should run GB50011 code-check', () => {
    expect(shouldRunDirectSeismicCodeCheck('seismic', {
      seismicWorkflow: { methodPreference: 'response_spectrum' },
    })).toBe(true);
    expect(shouldRunDirectSeismicCodeCheck('seismic', {
      autoCodeCheck: false,
      seismicWorkflow: { methodPreference: 'response_spectrum' },
    })).toBe(false);
    expect(shouldRunDirectSeismicCodeCheck('static', {
      seismicWorkflow: { methodPreference: 'response_spectrum' },
    })).toBe(false);
    expect(shouldRunDirectSeismicCodeCheck('seismic', {})).toBe(false);
  });

  test('builds a code-check model from the persisted analysis model', () => {
    const model = buildDirectAnalysisModelForCodeCheck({
      nodes: [{ id: 'N1' }],
      elements: [{ id: 'E1' }],
      materials: [{ id: 'C30' }],
      sections: [{ id: 'S1' }],
    });

    expect(model).toMatchObject({
      schemaVersion: '2.0.0',
      schema_version: '2.0.0',
      nodes: [{ id: 'N1' }],
      elements: [{ id: 'E1' }],
      materials: [{ id: 'C30' }],
      sections: [{ id: 'S1' }],
      loadCases: [],
      loadCombinations: [],
    });
  });

  test('resolves only GB50011-compatible design codes for direct China seismic checks', () => {
    expect(resolveDirectChinaSeismicDesignCode({})).toBe('GB/T 50011-2010-2024');
    expect(resolveDirectChinaSeismicDesignCode({ designCode: 'GB 55002+GB/T 50011' }))
      .toBe('GB 55002+GB/T 50011');
    expect(() => resolveDirectChinaSeismicDesignCode({ designCode: 'GB50017' }))
      .toThrow(/GB50011-compatible designCode/);
  });

  test('builds a direct seismic report from analysis and GB50011 code-check results', () => {
    const report = buildDirectSeismicReport({
      analysisName: 'direct seismic',
      analysisType: 'seismic',
      analysisResults: {
        success: true,
        data: {
          workflowInputMode: 'structured_seismic_workflow',
          designBasis: {
            codeBasis: [
              { code: 'GB 55002-2021' },
              { code: 'GB/T 50011-2010', edition: '2024 partial revision' },
            ],
          },
          methodDecision: { selectedMethods: ['response_spectrum'] },
        },
      },
      codeCheck: {
        data: {
          summary: { total: 4, passed: 3, failed: 0, warnings: 1 },
          details: [{
            elementId: '__global_seismic__',
            checks: [{ item: 'overall-final-compliance', status: 'pass', clause: 'GB 55002-2021' }],
          }],
        },
      },
      parameters: {
        locale: 'en',
        intent: 'Run China seismic design workflow',
      },
    });

    expect(report.summary).toContain('Code checks passed 3 / 4, failed 0, warnings 1');
    expect(report.json).toMatchObject({
      reportSchemaVersion: '1.0.0',
      intent: 'Run China seismic design workflow',
      analysisType: 'seismic',
      meta: {
        reportSkillId: 'report-export-builtin',
        reportSource: 'direct-analysis-api',
      },
    });
    expect(report.markdown).toContain('## Seismic Design');
    expect(report.markdown).toContain('structured seismicWorkflow');
  });

  test('persists GB50011 code-check and report output with direct structured seismic analysis results', async () => {
    const analysisResult = {
      success: true,
      data: {
        analysisMode: 'opensees_china_seismic_workflow',
        workflowInputMode: 'structured_seismic_workflow',
        designBasis: { siteSeismic: { intensity: 8 } },
        methodDecision: { selectedMethods: ['response_spectrum'] },
        envelope: { maxStoryDriftRatio: 0.001 },
      },
    };
    const codeCheckResult = {
      code: 'GB50011',
      status: 'success',
      summary: { total: 2, passed: 2, failed: 0, warnings: 0 },
    };
    const persistedModel = {
      nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }],
      elements: [{ id: 'E1', type: 'beam', nodes: ['N1', 'N2'] }],
      materials: [],
      sections: [],
    };
    const parameters = {
      seismicWorkflow: { methodPreference: 'response_spectrum' },
    };

    prisma.analysis.findUnique = jest.fn().mockResolvedValue({
      id: 'analysis-1',
      name: 'direct seismic task',
      type: 'seismic',
      parameters,
      model: persistedModel,
    });
    prisma.analysis.update = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'analysis-1',
      ...data,
    }));

    const service = new AnalysisService();
    service.executionService.analyze = jest.fn().mockResolvedValue(analysisResult);
    service.codeCheckExecutionService.codeCheck = jest.fn().mockResolvedValue(codeCheckResult);

    const updated = await service.runAnalysis('analysis-1');

    expect(service.codeCheckExecutionService.codeCheck).toHaveBeenCalledTimes(1);
    const codeCheckPayload = service.codeCheckExecutionService.codeCheck.mock.calls[0][0];
    expect(codeCheckPayload).toMatchObject({
      code: 'GB50011',
      context: {
        analysisSummary: {
          analysisMode: 'opensees_china_seismic_workflow',
          workflowInputMode: 'structured_seismic_workflow',
        },
        displayCode: 'GB 55002-2021 + GB/T 50011-2010 (2024 partial revision)',
        codeVersion: 'v2-global-seismic-gb55002-gbt50011-2024',
      },
    });
    expect(codeCheckPayload.elements).toEqual(expect.arrayContaining(['E1', '__global_seismic__']));
    expect(updated.results).toMatchObject({
      ...analysisResult,
      codeCheck: codeCheckResult,
      report: {
        summary: '分析类型 seismic，分析成功，校核通过 2 / 2，失败 0，警告 0。',
        json: {
          reportSchemaVersion: '1.0.0',
          analysisType: 'seismic',
          codeCheck: codeCheckResult,
          meta: {
            reportSkillId: 'report-export-builtin',
            reportSource: 'direct-analysis-api',
          },
        },
        markdown: expect.stringContaining('## 抗震专项'),
      },
    });
    expect(prisma.analysis.update).toHaveBeenLastCalledWith({
      where: { id: 'analysis-1' },
      data: expect.objectContaining({
        status: 'completed',
        results: expect.objectContaining({
          ...analysisResult,
          codeCheck: codeCheckResult,
          report: expect.objectContaining({
            summary: '分析类型 seismic，分析成功，校核通过 2 / 2，失败 0，警告 0。',
            markdown: expect.stringContaining('## 抗震专项'),
          }),
        }),
      }),
    });
  });

  test('fails direct structured seismic analysis when an incompatible design code is requested', async () => {
    const analysisResult = {
      success: true,
      data: {
        analysisMode: 'opensees_china_seismic_workflow',
        workflowInputMode: 'structured_seismic_workflow',
        designBasis: { siteSeismic: { intensity: 8 } },
        methodDecision: { selectedMethods: ['response_spectrum'] },
        envelope: { maxStoryDriftRatio: 0.001 },
      },
    };

    prisma.analysis.findUnique = jest.fn().mockResolvedValue({
      id: 'analysis-1',
      name: 'direct seismic task',
      type: 'seismic',
      parameters: {
        seismicWorkflow: { methodPreference: 'response_spectrum' },
        designCode: 'GB50017',
      },
      model: {
        nodes: [],
        elements: [],
        materials: [],
        sections: [],
      },
    });
    prisma.analysis.update = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'analysis-1',
      ...data,
    }));

    const service = new AnalysisService();
    service.executionService.analyze = jest.fn().mockResolvedValue(analysisResult);
    service.codeCheckExecutionService.codeCheck = jest.fn();

    await expect(service.runAnalysis('analysis-1')).rejects.toThrow(/GB50011-compatible designCode/);
    expect(service.codeCheckExecutionService.codeCheck).not.toHaveBeenCalled();
    expect(prisma.analysis.update).toHaveBeenLastCalledWith({
      where: { id: 'analysis-1' },
      data: expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('GB50011-compatible designCode'),
      }),
    });
  });
});
