import type { AppLocale } from '../services/locale.js';
import type { SkillReportNarrativeInput } from './types.js';

function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function renderClauseTraceabilityMarkdown(
  traceability: Array<Record<string, unknown>>,
  locale: AppLocale,
): string[] {
  if (traceability.length === 0) {
    return [localize(locale, '- 无条文追溯数据', '- No clause traceability data')];
  }
  return traceability.slice(0, 8).map((row) => {
    const elementId = row['elementId'] ?? 'unknown';
    const check = row['check'] ?? 'unknown';
    const clause = row['clause'] ?? '';
    const utilization = row['utilization'] ?? 'N/A';
    const status = row['status'] ?? 'unknown';
    return localize(
      locale,
      `- 构件 ${String(elementId)} / ${String(check)} / ${String(clause)} / 利用率 ${String(utilization)} / ${String(status)}`,
      `- Element ${String(elementId)} / ${String(check)} / ${String(clause)} / utilization ${String(utilization)} / ${String(status)}`,
    );
  });
}

function renderControllingCasesMarkdown(
  controllingCases: Record<string, unknown>,
  locale: AppLocale,
): string[] {
  const batchControlCaseRaw = controllingCases['batchControlCase'];
  const batchControlCase = batchControlCaseRaw && typeof batchControlCaseRaw === 'object'
    ? batchControlCaseRaw as Record<string, unknown>
    : {};

  return [
    localize(locale, `- 批量位移控制工况: ${String(batchControlCase['displacement'] ?? 'N/A')}`, `- Governing displacement case: ${String(batchControlCase['displacement'] ?? 'N/A')}`),
    localize(locale, `- 批量轴力控制工况: ${String(batchControlCase['axialForce'] ?? 'N/A')}`, `- Governing axial-force case: ${String(batchControlCase['axialForce'] ?? 'N/A')}`),
    localize(locale, `- 批量剪力控制工况: ${String(batchControlCase['shearForce'] ?? 'N/A')}`, `- Governing shear-force case: ${String(batchControlCase['shearForce'] ?? 'N/A')}`),
    localize(locale, `- 批量弯矩控制工况: ${String(batchControlCase['moment'] ?? 'N/A')}`, `- Governing moment case: ${String(batchControlCase['moment'] ?? 'N/A')}`),
    localize(locale, `- 批量反力控制工况: ${String(batchControlCase['reaction'] ?? 'N/A')}`, `- Governing reaction case: ${String(batchControlCase['reaction'] ?? 'N/A')}`),
    localize(locale, `- 位移控制节点: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`, `- Control displacement node: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`),
    localize(locale, `- 轴力控制单元: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`, `- Control axial-force element: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`),
    localize(locale, `- 剪力控制单元: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`, `- Control shear-force element: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`),
    localize(locale, `- 弯矩控制单元: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`, `- Control moment element: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`),
    localize(locale, `- 反力控制节点: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`, `- Control reaction node: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`),
  ];
}

export function buildDefaultReportNarrative(input: SkillReportNarrativeInput): string {
  const { locale, message, analysisType, analysisSuccess, codeCheckText, summary, keyMetrics, clauseTraceability, controllingCases } = input;

  return [
    localize(locale, '# StructureClaw 计算报告', '# StructureClaw Calculation Report'),
    '',
    localize(locale, '## 目录', '## Contents'),
    localize(locale, '1. 执行摘要', '1. Executive Summary'),
    localize(locale, '2. 关键指标', '2. Key Metrics'),
    localize(locale, '3. 条文追溯', '3. Clause Traceability'),
    localize(locale, '4. 控制工况', '4. Governing Cases'),
    '',
    localize(locale, '## 执行摘要', '## Executive Summary'),
    localize(locale, `- 用户意图：${message}`, `- User intent: ${message}`),
    localize(locale, `- 分析类型：${analysisType}`, `- Analysis type: ${analysisType}`),
    localize(locale, `- 分析结果：${analysisSuccess ? '成功' : '失败'}`, `- Analysis result: ${analysisSuccess ? 'Success' : 'Failure'}`),
    localize(locale, `- 规范校核：${codeCheckText}`, `- Code checks: ${codeCheckText}`),
    '',
    summary,
    '',
    localize(locale, '## 关键指标', '## Key Metrics'),
    localize(locale, `- 最大位移: ${String(keyMetrics.maxAbsDisplacement ?? 'N/A')}`, `- Max displacement: ${String(keyMetrics.maxAbsDisplacement ?? 'N/A')}`),
    localize(locale, `- 最大轴力: ${String(keyMetrics.maxAbsAxialForce ?? 'N/A')}`, `- Max axial force: ${String(keyMetrics.maxAbsAxialForce ?? 'N/A')}`),
    localize(locale, `- 最大剪力: ${String(keyMetrics.maxAbsShearForce ?? 'N/A')}`, `- Max shear force: ${String(keyMetrics.maxAbsShearForce ?? 'N/A')}`),
    localize(locale, `- 最大弯矩: ${String(keyMetrics.maxAbsMoment ?? 'N/A')}`, `- Max moment: ${String(keyMetrics.maxAbsMoment ?? 'N/A')}`),
    localize(locale, `- 最大反力: ${String(keyMetrics.maxAbsReaction ?? 'N/A')}`, `- Max reaction: ${String(keyMetrics.maxAbsReaction ?? 'N/A')}`),
    localize(locale, `- 校核通过率: ${String(keyMetrics.codeCheckPassRate ?? 'N/A')}`, `- Code-check pass rate: ${String(keyMetrics.codeCheckPassRate ?? 'N/A')}`),
    '',
    localize(locale, '## 条文追溯', '## Clause Traceability'),
    ...renderClauseTraceabilityMarkdown(clauseTraceability, locale),
    '',
    localize(locale, '## 控制工况', '## Governing Cases'),
    ...renderControllingCasesMarkdown(controllingCases, locale),
  ].join('\n');
}
