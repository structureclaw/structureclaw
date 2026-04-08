import type { ToolManifest } from '../../agent-runtime/types.js';
import type { AppLocale } from '../../services/locale.js';
import type { DraftState } from '../../agent-runtime/index.js';
import type { AgentToolCall, AgentToolName } from '../../services/agent.js';
import { localize } from './shared.js';

export async function executeGenerateReport(
  params: {
    runGenerateReport: () => Promise<{ summary: string; json: Record<string, unknown>; markdown?: string } | undefined>;
  },
): Promise<{ summary: string; json: Record<string, unknown>; markdown?: string } | undefined> {
  return params.runGenerateReport();
}

export async function executeGenerateReportStep(args: {
  message: string;
  locale: AppLocale;
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  analysis: any;
  codeCheck?: unknown;
  format: 'json' | 'markdown' | 'both';
  reportOutput: 'inline' | 'file';
  draft?: DraftState;
  skillIds?: string[];
  traceId: string;
  plan: string[];
  toolCalls: AgentToolCall[];
  localize: (locale: AppLocale, zh: string, en: string) => string;
  startToolCall: (tool: AgentToolName, input: Record<string, unknown>) => AgentToolCall;
  completeToolCallSuccess: (call: AgentToolCall, output?: unknown) => void;
  generateReport: () => Promise<{ summary: string; json: Record<string, unknown>; markdown?: string } | undefined>;
  persistReportArtifacts: (traceId: string, report: { summary: string; json: Record<string, unknown>; markdown?: string }, reportFormat: 'json' | 'markdown' | 'both') => Promise<Array<{ type: 'report'; format: 'json' | 'markdown'; path: string }> | undefined>;
}): Promise<{ report?: { summary: string; json: Record<string, unknown>; markdown?: string }; artifacts?: Array<{ type: 'report'; format: 'json' | 'markdown'; path: string }> }> {
  args.plan.push(args.localize(args.locale, '生成可读计算与规范校核报告', 'Generate a readable analysis and run_code_check report'));
  const reportCall = args.startToolCall('generate_report', {
    message: args.message,
    analysis: args.analysis,
    codeCheck: args.codeCheck,
    format: args.format,
  });
  args.toolCalls.push(reportCall);

  const report = await executeGenerateReport({
    runGenerateReport: args.generateReport,
  });
  const artifacts = report && args.reportOutput === 'file'
    ? await args.persistReportArtifacts(args.traceId, report, args.format)
    : undefined;
  args.completeToolCallSuccess(reportCall, report);
  return { report, artifacts };
}

export const GENERATE_REPORT_TOOL_MANIFEST: ToolManifest = {
  id: 'generate_report',
  source: 'builtin',
  enabledByDefault: false,
  category: 'report',
  displayName: localize('生成报告', 'Generate Report'),
  description: localize('将模型、分析与规范校核结果汇总为可读报告。', 'Assemble inputs, analysis, and run_code_check outputs into a readable report.'),
  tags: ['generate_report', 'artifact'],
  inputSchema: {
    type: 'object',
    required: ['message', 'analysis'],
    properties: {
      message: { type: 'string' },
      analysis: { type: 'object' },
      codeCheck: { type: 'object' },
      format: { enum: ['json', 'markdown', 'both'] },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      json: { type: 'object' },
      markdown: { type: 'string' },
    },
  },
  requiresTools: ['run_analysis'],
  errorCodes: [],
};
