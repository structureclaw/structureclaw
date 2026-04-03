import { describe, expect, it } from '@jest/globals';
import { buildDefaultReportNarrative } from '../dist/agent-runtime/report-template.js';

/** Minimal valid input for buildDefaultReportNarrative. */
function makeInput(overrides = {}) {
  return {
    locale: 'en',
    message: 'Analyze a steel portal frame',
    analysisType: 'static',
    analysisSuccess: true,
    codeCheckText: 'All checks passed',
    summary: 'The structure meets code requirements.',
    keyMetrics: {
      maxAbsDisplacement: 12.5,
      maxAbsAxialForce: 340.2,
      maxAbsShearForce: 85.1,
      maxAbsMoment: 210.0,
      maxAbsReaction: 95.3,
      codeCheckPassRate: 0.97,
    },
    clauseTraceability: [
      {
        elementId: 'E1',
        check: 'shear',
        clause: 'GB50017-2017 4.1.2',
        utilization: 0.85,
        status: 'pass',
      },
      {
        elementId: 'E2',
        check: 'axial',
        clause: 'GB50017-2017 5.1.1',
        utilization: 0.72,
        status: 'pass',
      },
    ],
    controllingCases: {
      batchControlCase: {
        displacement: 'DL1',
        axialForce: 'DL2',
        shearForce: 'DL1',
        moment: 'DL2',
        reaction: 'DL1',
      },
      controlNodeDisplacement: 'N3',
      controlElementAxialForce: 'E1',
      controlElementShearForce: 'E2',
      controlElementMoment: 'E1',
      controlNodeReaction: 'N5',
    },
    visualizationHints: {},
    ...overrides,
  };
}

describe('buildDefaultReportNarrative', () => {
  // ---------------------------------------------------------------------------
  // Full report — English locale
  // ---------------------------------------------------------------------------
  it('produces a complete markdown report in English', () => {
    const report = buildDefaultReportNarrative(makeInput());

    expect(report).toContain('# StructureClaw Calculation Report');
    expect(report).toContain('## Contents');
    expect(report).toContain('## Executive Summary');
    expect(report).toContain('## Key Metrics');
    expect(report).toContain('## Clause Traceability');
    expect(report).toContain('## Governing Cases');

    // Executive summary fields
    expect(report).toContain('User intent: Analyze a steel portal frame');
    expect(report).toContain('Analysis type: static');
    expect(report).toContain('Analysis result: Success');
    expect(report).toContain('Code checks: All checks passed');
    expect(report).toContain('The structure meets code requirements.');

    // Key metrics
    expect(report).toContain('Max displacement: 12.5');
    expect(report).toContain('Max axial force: 340.2');
    expect(report).toContain('Max shear force: 85.1');
    expect(report).toContain('Max moment: 210');
    expect(report).toContain('Max reaction: 95.3');
    expect(report).toContain('Code-check pass rate: 0.97');

    // Clause traceability rows
    expect(report).toContain('Element E1 / shear / GB50017-2017 4.1.2 / utilization 0.85 / pass');
    expect(report).toContain('Element E2 / axial / GB50017-2017 5.1.1 / utilization 0.72 / pass');

    // Governing cases
    expect(report).toContain('Governing displacement case: DL1');
    expect(report).toContain('Governing axial-force case: DL2');
    expect(report).toContain('Governing shear-force case: DL1');
    expect(report).toContain('Governing moment case: DL2');
    expect(report).toContain('Governing reaction case: DL1');
    expect(report).toContain('Control displacement node: N3');
    expect(report).toContain('Control axial-force element: E1');
    expect(report).toContain('Control shear-force element: E2');
    expect(report).toContain('Control moment element: E1');
    expect(report).toContain('Control reaction node: N5');
  });

  // ---------------------------------------------------------------------------
  // Chinese locale
  // ---------------------------------------------------------------------------
  it('produces a complete markdown report in Chinese', () => {
    const report = buildDefaultReportNarrative(makeInput({ locale: 'zh' }));

    expect(report).toContain('# StructureClaw 计算报告');
    expect(report).toContain('## 目录');
    expect(report).toContain('1. 执行摘要');
    expect(report).toContain('2. 关键指标');
    expect(report).toContain('3. 条文追溯');
    expect(report).toContain('4. 控制工况');
    expect(report).toContain('## 执行摘要');
    expect(report).toContain('用户意图：Analyze a steel portal frame');
    expect(report).toContain('分析类型：static');
    expect(report).toContain('分析结果：成功');
    expect(report).toContain('规范校核：All checks passed');
    expect(report).toContain('## 关键指标');
    expect(report).toContain('最大位移: 12.5');
    expect(report).toContain('最大轴力: 340.2');
    expect(report).toContain('## 条文追溯');
    expect(report).toContain('## 控制工况');
    expect(report).toContain('批量位移控制工况: DL1');
    expect(report).toContain('位移控制节点: N3');
  });

  // ---------------------------------------------------------------------------
  // analysisSuccess = false
  // ---------------------------------------------------------------------------
  it('shows Failure when analysisSuccess is false (English)', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ analysisSuccess: false }),
    );

    expect(report).toContain('Analysis result: Failure');
    expect(report).not.toContain('Analysis result: Success');
  });

  it('shows failure when analysisSuccess is false (Chinese)', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ locale: 'zh', analysisSuccess: false }),
    );

    expect(report).toContain('分析结果：失败');
  });

  // ---------------------------------------------------------------------------
  // Empty clause traceability
  // ---------------------------------------------------------------------------
  it('renders no-clause-traceability message when traceability array is empty', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ clauseTraceability: [] }),
    );

    expect(report).toContain('No clause traceability data');
    expect(report).not.toContain('Element E1');
  });

  it('renders no-clause-traceability message in Chinese when array is empty', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ locale: 'zh', clauseTraceability: [] }),
    );

    expect(report).toContain('无条文追溯数据');
  });

  // ---------------------------------------------------------------------------
  // Clause traceability with missing fields (defaults to unknown)
  // ---------------------------------------------------------------------------
  it('defaults to unknown for missing fields in traceability rows', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        clauseTraceability: [{ /* no fields */ }],
      }),
    );

    expect(report).toContain('Element unknown / unknown /  / utilization N/A / unknown');
  });

  // ---------------------------------------------------------------------------
  // Clause traceability is sliced to 8 rows max
  // ---------------------------------------------------------------------------
  it('limits clause traceability to 8 rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      elementId: `E${i}`,
      check: 'shear',
      clause: 'C',
      utilization: 0.5,
      status: 'pass',
    }));

    const report = buildDefaultReportNarrative(
      makeInput({ clauseTraceability: rows }),
    );

    // Rows 0–7 should appear
    expect(report).toContain('Element E0 ');
    expect(report).toContain('Element E7 ');
    // Rows 8–11 should NOT appear
    expect(report).not.toContain('Element E8 ');
    expect(report).not.toContain('Element E11 ');
  });

  // ---------------------------------------------------------------------------
  // Controlling cases — batchControlCase absent / not an object
  // ---------------------------------------------------------------------------
  it('falls back to N/A when batchControlCase is missing', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        controllingCases: {
          // batchControlCase key is absent
          controlNodeDisplacement: 'N1',
          controlElementAxialForce: 'E1',
          controlElementShearForce: 'E2',
          controlElementMoment: 'E3',
          controlNodeReaction: 'N2',
        },
      }),
    );

    expect(report).toContain('Governing displacement case: N/A');
    expect(report).toContain('Governing axial-force case: N/A');
    expect(report).toContain('Governing shear-force case: N/A');
    expect(report).toContain('Governing moment case: N/A');
    expect(report).toContain('Governing reaction case: N/A');
    // Non-batch fields still render
    expect(report).toContain('Control displacement node: N1');
  });

  it('falls back to N/A when batchControlCase is not an object (string)', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        controllingCases: {
          batchControlCase: 'not-an-object',
          controlNodeDisplacement: 'N1',
          controlElementAxialForce: 'E1',
          controlElementShearForce: 'E2',
          controlElementMoment: 'E3',
          controlNodeReaction: 'N2',
        },
      }),
    );

    expect(report).toContain('Governing displacement case: N/A');
  });

  it('falls back to N/A when batchControlCase is null', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        controllingCases: {
          batchControlCase: null,
          controlNodeDisplacement: 'N1',
          controlElementAxialForce: 'E1',
          controlElementShearForce: 'E2',
          controlElementMoment: 'E3',
          controlNodeReaction: 'N2',
        },
      }),
    );

    expect(report).toContain('Governing displacement case: N/A');
  });

  // ---------------------------------------------------------------------------
  // Controlling cases — individual fields missing
  // ---------------------------------------------------------------------------
  it('falls back to N/A for missing top-level controlling-case fields', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        controllingCases: {
          batchControlCase: {
            displacement: 'DL1',
            axialForce: 'DL2',
            shearForce: 'DL3',
            moment: 'DL4',
            reaction: 'DL5',
          },
          // top-level fields omitted
        },
      }),
    );

    expect(report).toContain('Control displacement node: N/A');
    expect(report).toContain('Control axial-force element: N/A');
    expect(report).toContain('Control shear-force element: N/A');
    expect(report).toContain('Control moment element: N/A');
    expect(report).toContain('Control reaction node: N/A');
  });

  it('falls back to N/A for missing batchControlCase sub-fields', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        controllingCases: {
          batchControlCase: {
            displacement: 'DL1',
            // other sub-fields omitted
          },
          controlNodeDisplacement: 'N1',
          controlElementAxialForce: 'E1',
          controlElementShearForce: 'E2',
          controlElementMoment: 'E3',
          controlNodeReaction: 'N2',
        },
      }),
    );

    expect(report).toContain('Governing displacement case: DL1');
    expect(report).toContain('Governing axial-force case: N/A');
    expect(report).toContain('Governing shear-force case: N/A');
    expect(report).toContain('Governing moment case: N/A');
    expect(report).toContain('Governing reaction case: N/A');
  });

  // ---------------------------------------------------------------------------
  // Key metrics — missing values fall back to N/A
  // ---------------------------------------------------------------------------
  it('falls back to N/A for missing key metrics', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ keyMetrics: {} }),
    );

    expect(report).toContain('Max displacement: N/A');
    expect(report).toContain('Max axial force: N/A');
    expect(report).toContain('Max shear force: N/A');
    expect(report).toContain('Max moment: N/A');
    expect(report).toContain('Max reaction: N/A');
    expect(report).toContain('Code-check pass rate: N/A');
  });

  // ---------------------------------------------------------------------------
  // Chinese locale for key metrics N/A fallbacks
  // ---------------------------------------------------------------------------
  it('renders Chinese N/A fallbacks for missing key metrics', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ locale: 'zh', keyMetrics: {} }),
    );

    expect(report).toContain('最大位移: N/A');
    expect(report).toContain('最大轴力: N/A');
    expect(report).toContain('最大剪力: N/A');
    expect(report).toContain('最大弯矩: N/A');
    expect(report).toContain('最大反力: N/A');
    expect(report).toContain('校核通过率: N/A');
  });

  // ---------------------------------------------------------------------------
  // Controlling cases — Chinese locale
  // ---------------------------------------------------------------------------
  it('renders governing cases in Chinese', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ locale: 'zh' }),
    );

    expect(report).toContain('批量位移控制工况: DL1');
    expect(report).toContain('批量轴力控制工况: DL2');
    expect(report).toContain('批量剪力控制工况: DL1');
    expect(report).toContain('批量弯矩控制工况: DL2');
    expect(report).toContain('批量反力控制工况: DL1');
    expect(report).toContain('位移控制节点: N3');
    expect(report).toContain('轴力控制单元: E1');
    expect(report).toContain('剪力控制单元: E2');
    expect(report).toContain('弯矩控制单元: E1');
    expect(report).toContain('反力控制节点: N5');
  });

  // ---------------------------------------------------------------------------
  // Controlling cases — Chinese N/A fallbacks
  // ---------------------------------------------------------------------------
  it('renders Chinese N/A fallbacks for missing governing cases', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ locale: 'zh', controllingCases: {} }),
    );

    expect(report).toContain('批量位移控制工况: N/A');
    expect(report).toContain('位移控制节点: N/A');
  });

  // ---------------------------------------------------------------------------
  // Traceability — Chinese locale with populated rows
  // ---------------------------------------------------------------------------
  it('renders traceability rows in Chinese', () => {
    const report = buildDefaultReportNarrative(
      makeInput({
        locale: 'zh',
        clauseTraceability: [
          { elementId: 'B1', check: 'bending', clause: '4.2.1', utilization: 0.9, status: 'pass' },
        ],
      }),
    );

    expect(report).toContain('构件 B1 / bending / 4.2.1 / 利用率 0.9 / pass');
  });

  // ---------------------------------------------------------------------------
  // Different analysis types
  // ---------------------------------------------------------------------------
  it('includes the analysis type in the report', () => {
    for (const type of ['static', 'dynamic', 'seismic', 'nonlinear']) {
      const report = buildDefaultReportNarrative(makeInput({ analysisType: type }));
      expect(report).toContain(`Analysis type: ${type}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Summary is included verbatim
  // ---------------------------------------------------------------------------
  it('includes the summary text verbatim', () => {
    const summary = 'Custom multi-line\nsummary with **markdown**.';
    const report = buildDefaultReportNarrative(makeInput({ summary }));

    expect(report).toContain(summary);
  });

  // ---------------------------------------------------------------------------
  // codeCheckText is included
  // ---------------------------------------------------------------------------
  it('includes the codeCheckText value', () => {
    const report = buildDefaultReportNarrative(
      makeInput({ codeCheckText: '3 of 5 checks failed' }),
    );

    expect(report).toContain('Code checks: 3 of 5 checks failed');
  });

  // ---------------------------------------------------------------------------
  // Structural checks: the report always contains the expected section order
  // ---------------------------------------------------------------------------
  it('orders sections correctly (Contents, Summary, Metrics, Traceability, Governing)', () => {
    const report = buildDefaultReportNarrative(makeInput());

    const contentsIdx = report.indexOf('## Contents');
    const summaryIdx = report.indexOf('## Executive Summary');
    const metricsIdx = report.indexOf('## Key Metrics');
    const traceIdx = report.indexOf('## Clause Traceability');
    const governingIdx = report.indexOf('## Governing Cases');

    expect(contentsIdx).toBeLessThan(summaryIdx);
    expect(summaryIdx).toBeLessThan(metricsIdx);
    expect(metricsIdx).toBeLessThan(traceIdx);
    expect(traceIdx).toBeLessThan(governingIdx);
  });
});
