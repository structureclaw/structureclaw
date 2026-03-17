import type { AxiosInstance } from 'axios';
import type { AppLocale } from '../../services/locale.js';

export interface CodeCheckDomainInput extends Record<string, unknown> {
  modelId: string;
  code: string;
  elements: string[];
  context: {
    analysisSummary: Record<string, unknown>;
    utilizationByElement: Record<string, unknown>;
  };
}

export function extractElementIds(model: Record<string, unknown> | undefined): string[] {
  if (!model) {
    return [];
  }
  const elements = model['elements'];
  if (!Array.isArray(elements)) {
    return [];
  }
  return elements
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function extractAnalysisSummary(analysis: unknown): Record<string, unknown> {
  const data = analysis as Record<string, unknown> | undefined;
  if (!data) {
    return {};
  }
  return {
    analysisType: data['analysis_type'],
    success: data['success'],
    errorCode: data['error_code'],
    message: data['message'],
  };
}

export function extractUtilizationByElement(parameters: Record<string, unknown>): Record<string, unknown> {
  const raw = parameters['utilizationByElement'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function buildCodeCheckInput(options: {
  traceId: string;
  designCode: string;
  model: Record<string, unknown>;
  analysis: unknown;
  analysisParameters: Record<string, unknown>;
  codeCheckElements?: string[];
}): CodeCheckDomainInput {
  return {
    modelId: options.traceId,
    code: options.designCode,
    elements: options.codeCheckElements?.length ? options.codeCheckElements : extractElementIds(options.model),
    context: {
      analysisSummary: extractAnalysisSummary(options.analysis),
      utilizationByElement: extractUtilizationByElement(options.analysisParameters),
    },
  };
}

export async function executeCodeCheckDomain(
  engineClient: AxiosInstance,
  input: CodeCheckDomainInput,
  engineId?: string,
): Promise<unknown> {
  const codeChecked = await engineClient.post('/code-check', {
    model_id: input.modelId,
    code: input.code,
    elements: input.elements,
    context: input.context,
    engineId,
  });
  return codeChecked.data;
}

export function buildCodeCheckSummaryText(options: {
  codeCheck: unknown;
  locale: AppLocale;
  localize: (locale: AppLocale, zh: string, en: string) => string;
}): string {
  const codeCheckSummary = (options.codeCheck as { summary?: Record<string, unknown> } | undefined)?.summary;
  if (codeCheckSummary) {
    return options.localize(
      options.locale,
      `校核通过 ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`,
      `Code checks passed ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`,
    );
  }
  return options.localize(options.locale, '未执行规范校核', 'No code checks were executed');
}
