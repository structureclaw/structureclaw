import {
  resolveCodeCheckRule,
} from './registry.js';
import type { CodeCheckDomainInput } from './types.js';
import type { CodeCheckClient } from './rule.js';
import type { ExecutionRequestOptions } from '../analysis/types.js';

export type { CodeCheckDomainInput } from './types.js';
export {
  listCodeCheckRuleProviders,
  resolveCodeCheckDesignCodeFromSkillIds,
} from './registry.js';

function extractElementIds(model: Record<string, unknown> | undefined): string[] {
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

function extractAnalysisSummary(analysis: unknown): Record<string, unknown> {
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

function extractUtilizationByElement(parameters: Record<string, unknown>): Record<string, unknown> {
  const raw = parameters['utilizationByElement'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function extractElementContextById(model: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!model) {
    return {};
  }

  const elements = model['elements'];
  if (!Array.isArray(elements)) {
    return {};
  }
  const materials = Array.isArray(model['materials']) ? model['materials'] : [];
  const sections = Array.isArray(model['sections']) ? model['sections'] : [];
  const materialById = materials.reduce<Map<string, Record<string, unknown>>>((acc, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return acc;
    const record = item as Record<string, unknown>;
    const id = String(record['id'] ?? '');
    if (id.length > 0) acc.set(id, record);
    return acc;
  }, new Map());
  const sectionById = sections.reduce<Map<string, Record<string, unknown>>>((acc, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return acc;
    const record = item as Record<string, unknown>;
    const id = String(record['id'] ?? '');
    if (id.length > 0) acc.set(id, record);
    return acc;
  }, new Map());

  return elements.reduce<Record<string, unknown>>((acc, item) => {
    if (!item || typeof item !== 'object') {
      return acc;
    }
    const element = item as Record<string, unknown>;
    const id = typeof element['id'] === 'string' ? element['id'] : undefined;
    if (!id) {
      return acc;
    }
    const materialId = typeof element['material'] === 'string' ? element['material'] : undefined;
    const sectionId = typeof element['section'] === 'string' ? element['section'] : undefined;

    acc[id] = {
      id,
      type: element['type'],
      material: materialId ? (materialById.get(materialId) ?? materialId) : element['material'],
      section: sectionId ? (sectionById.get(sectionId) ?? sectionId) : element['section'],
      materialId,
      sectionId,
      startNode: element['startNode'],
      endNode: element['endNode'],
      nodes: element['nodes'],
      story: element['story'],
      concreteGrade: element['concrete_grade'],
      steelGrade: element['steel_grade'],
      rebarGrade: element['rebar_grade'],
      metadata: element['metadata'],
    };
    return acc;
  }, {});
}

function extractModelSummary(model: Record<string, unknown> | undefined): Record<string, unknown> {
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
  requestOptions?: ExecutionRequestOptions,
): Promise<unknown> {
  const rule = resolveCodeCheckRule(input.code);
  return rule.execute(engineClient, input, engineId, requestOptions);
}
