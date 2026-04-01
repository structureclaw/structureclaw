import type { ToolManifest } from '../../agent-runtime/types.js';
import type { AppLocale } from '../../services/locale.js';
import type { DraftState } from '../../agent-runtime/index.js';
import { localize } from './shared.js';

type GenerateReportFn = (params: {
  message: string;
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  analysis: any;
  codeCheck?: unknown;
  format: 'json' | 'markdown' | 'both';
  locale: AppLocale;
  draft?: DraftState;
  skillIds?: string[];
}) => Promise<{ summary: string; json: Record<string, unknown>; markdown?: string } | undefined>;

export async function executeGenerateReport(
  generateReport: GenerateReportFn,
  params: {
    message: string;
    analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    analysis: any;
    codeCheck?: unknown;
    format: 'json' | 'markdown' | 'both';
    locale: AppLocale;
    draft?: DraftState;
    skillIds?: string[];
  },
): Promise<{ summary: string; json: Record<string, unknown>; markdown?: string } | undefined> {
  return generateReport(params);
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
