import type { AppLocale } from '../../services/locale.js';
import {
  resolveCodeCheckRule,
} from './registry.js';
import type { CodeCheckDomainInput } from './types.js';
import type { CodeCheckClient } from './rule.js';

export type { CodeCheckDomainInput } from './types.js';
export {
  listCodeCheckRuleProviders,
  resolveCodeCheckDesignCodeFromSkillIds,
  resolveCodeCheckSkillIdForDesignCode,
} from './registry.js';

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

export function extractElementContextById(model: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!model) {
    return {};
  }

  const elements = model['elements'];
  if (!Array.isArray(elements)) {
    return {};
  }

  return elements.reduce<Record<string, unknown>>((acc, item) => {
    if (!item || typeof item !== 'object') {
      return acc;
    }
    const element = item as Record<string, unknown>;
    const id = typeof element['id'] === 'string' ? element['id'] : undefined;
    if (!id) {
      return acc;
    }

    acc[id] = {
      id,
      type: element['type'],
      material: element['material'],
      section: element['section'],
      startNode: element['startNode'],
      endNode: element['endNode'],
      metadata: element['metadata'],
    };
    return acc;
  }, {});
}

export function extractModelSummary(model: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!model) {
    return {};
  }

  const metadata = model['metadata'];
  const metadataObject = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};

  return {
    modelType: model['type'] ?? metadataObject['modelType'] ?? null,
    elementCount: extractElementIds(model).length,
    units: metadataObject['units'] ?? null,
    designCode: metadataObject['designCode'] ?? null,
  };
}

export function buildCodeCheckInput(options: {
  traceId: string;
  designCode: string;
  model: Record<string, unknown>;
  analysis: unknown;
  analysisParameters: Record<string, unknown>;
  postprocessedResult?: Record<string, unknown>;
  codeCheckElements?: string[];
}): CodeCheckDomainInput {
  const postprocessedUtil = options.postprocessedResult
    ? extractUtilizationByElement(options.postprocessedResult)
    : {};
  const parameterUtil = extractUtilizationByElement(options.analysisParameters);
  const utilizationByElement = { ...postprocessedUtil, ...parameterUtil };
  return {
    modelId: options.traceId,
    code: options.designCode,
    elements: options.codeCheckElements?.length ? options.codeCheckElements : extractElementIds(options.model),
    context: {
      analysisSummary: extractAnalysisSummary(options.analysis),
      utilizationByElement,
      elementContextById: extractElementContextById(options.model),
      modelSummary: extractModelSummary(options.model),
    },
  };
}

export async function executeCodeCheckDomain(
  engineClient: CodeCheckClient,
  input: CodeCheckDomainInput,
  engineId?: string,
): Promise<unknown> {
  const rule = resolveCodeCheckRule(input.code);
  return rule.execute(engineClient, input, engineId);
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
