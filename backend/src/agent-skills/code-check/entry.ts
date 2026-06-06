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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function extractUtilizationByElement(source: unknown): Record<string, unknown> {
  const sourceObject = asRecord(source);
  const dataObject = asRecord(sourceObject['data']);
  const envelopeObject = asRecord(sourceObject['envelope']);
  const dataEnvelopeObject = asRecord(dataObject['envelope']);

  const candidates = [
    dataEnvelopeObject['elementUtilization'],
    envelopeObject['elementUtilization'],
    dataObject['utilizationByElement'],
    sourceObject['utilizationByElement'],
  ];

  return candidates.reduce<Record<string, unknown>>((acc, raw) => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...acc, ...(raw as Record<string, unknown>) };
    }
    return acc;
  }, {});
}

function extractAnalysisSummary(analysis: unknown): Record<string, unknown> {
  const data = asRecord(analysis);
  return {
    analysisType: data['analysis_type'],
    success: data['success'],
    errorCode: data['error_code'],
    message: data['message'],
  };
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

/**
 * Take the larger absolute value of two numbers; returns undefined if both are falsy.
 */
function envelopeAbs(a: unknown, b: unknown): number | undefined {
  const va = typeof a === 'number' ? Math.abs(a) : 0;
  const vb = typeof b === 'number' ? Math.abs(b) : 0;
  if (va === 0 && vb === 0) return undefined;
  return va >= vb ? va : vb;
}

/**
 * 从模型和分析结果中提取 elementData，供 Python code-check 层消费。
 *
 * 合并三项数据源:
 *   1. model.elements[] — 构件类型、截面/材料 ID、始末节点
 *   2. model.sections[] / model.materials[] — 截面/材料属性
 *   3. analysisResult.data.forces[] — OpenSees 计算的每构件内力
 *
 * 返回格式与 gb50017 `_compute_utilization_overrides()` 期望的 elementData 一致。
 */
function extractElementDataForCodeCheck(
  model: Record<string, unknown> | undefined,
  analysisResult: unknown,
): Record<string, Record<string, unknown>> {
  if (!model) return {};

  const elements = Array.isArray(model['elements']) ? model['elements'] as Record<string, unknown>[] : [];
  const sections = Array.isArray(model['sections']) ? model['sections'] as Record<string, unknown>[] : [];
  const materials = Array.isArray(model['materials']) ? model['materials'] as Record<string, unknown>[] : [];
  const nodes = Array.isArray(model['nodes']) ? model['nodes'] as Record<string, unknown>[] : [];

  // unwrap OpenSees AnalysisResponse: { data: { forces: { ... } } }
  const analysis = analysisResult as Record<string, unknown> | undefined;
  const data = analysis?.['data'] as Record<string, unknown> | undefined;
  const rawForces = data?.['forces'] as Record<string, unknown> | undefined;
  const forces: Record<string, Record<string, unknown>> = {};
  if (rawForces) {
    for (const [elemId, value] of Object.entries(rawForces)) {
      if (value && typeof value === 'object') {
        forces[elemId] = value as Record<string, unknown>;
      }
    }
  }

  // lookup tables: section/material/node by id (supports both string and number IDs)
  const sectionById: Record<string, Record<string, unknown>> = {};
  for (const s of sections) {
    if (s && typeof s === 'object' && (typeof s['id'] === 'string' || typeof s['id'] === 'number')) {
      sectionById[String(s['id'])] = s;
    }
  }
  const materialById: Record<string, Record<string, unknown>> = {};
  for (const m of materials) {
    if (m && typeof m === 'object' && (typeof m['id'] === 'string' || typeof m['id'] === 'number')) {
      materialById[String(m['id'])] = m;
    }
  }
  const nodeById: Record<string, Record<string, unknown>> = {};
  for (const n of nodes) {
    if (n && typeof n === 'object' && (typeof n['id'] === 'string' || typeof n['id'] === 'number')) {
      nodeById[String(n['id'])] = n;
    }
  }

  const elementData: Record<string, Record<string, unknown>> = {};

  for (const elem of elements) {
    if (!elem || typeof elem !== 'object') continue;
    const elemId = typeof elem['id'] === 'string' ? elem['id'] : '';
    if (!elemId) continue;

    // section properties
    const sectionId = String(elem['section'] ?? '');
    const sectionObj = sectionById[sectionId];
    const sectionProps = (sectionObj?.['properties'] as Record<string, unknown>) ?? {};
    const sectionShape = sectionObj?.['shape'] as Record<string, unknown> | undefined;

    // material properties
    const materialId = String(elem['material'] ?? '');
    const materialObj = materialById[materialId];

    // forces: n1/n2 envelope (take max absolute per component)
    const elemForces = forces[elemId];
    const n1Forces = (elemForces?.['n1'] as Record<string, unknown>) ?? elemForces ?? {};
    const n2Forces = (elemForces?.['n2'] as Record<string, unknown>) ?? {};
    const envelopeN = envelopeAbs(n1Forces['N'], n2Forces['N']);
    const envelopeV = envelopeAbs(n1Forces['V'], n2Forces['V']);
    const rawM1 = n1Forces['Mx'] !== undefined ? n1Forces['Mx'] : n1Forces['M'];
    const rawM2 = n2Forces['Mx'] !== undefined ? n2Forces['Mx'] : n2Forces['M'];
    const envelopeMx = envelopeAbs(rawM1, rawM2);

    // element length from node coordinates (m → mm)
    const elemNodes = Array.isArray(elem['nodes']) ? (elem['nodes'] as string[]) : [];
    const nodeStart = elemNodes.length >= 1 ? nodeById[elemNodes[0]!] : undefined;
    const nodeEnd = elemNodes.length >= 2 ? nodeById[elemNodes[1]!] : undefined;
    let lengthMm: number | undefined;
    if (nodeStart && nodeEnd) {
      const dx = (Number(nodeStart['x'] ?? 0) - Number(nodeEnd['x'] ?? 0));
      const dy = (Number(nodeStart['y'] ?? 0) - Number(nodeEnd['y'] ?? 0));
      const dz = (Number(nodeStart['z'] ?? 0) - Number(nodeEnd['z'] ?? 0));
      lengthMm = Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000; // m → mm
    }

    // unit conversions: model sections in m²/m⁴ → mm²/mm⁴
    const A_m2 = Number(sectionProps['A'] ?? 0);
    const Iy_m4 = Number(sectionProps['Iy'] ?? 0);
    const Iz_m4 = Number(sectionProps['Iz'] ?? 0);
    const J_m4 = Number(sectionProps['J'] ?? 0);
    const Wx_m3 = Number(sectionProps['Wx'] ?? sectionProps['Wnx'] ?? 0);
    const S_m3 = Number(sectionProps['S'] ?? 0);
    const tw_m = Number(sectionProps['tw'] ?? 0);
    const As_m2 = Number(sectionProps['As'] ?? 0);

    const A_mm2 = A_m2 * 1e6;
    const Iy_mm4 = Iy_m4 * 1e12;
    const Iz_mm4 = Iz_m4 * 1e12;
    const J_mm4 = J_m4 * 1e12;
    const Wx_mm3 = Wx_m3 * 1e9;
    const S_mm3 = S_m3 * 1e9;
    const tw_mm = tw_m * 1e3;
    const As_mm2 = As_m2 * 1e6;

    // rotation radius i = sqrt(I / A) in mm
    const i_min = A_mm2 > 0 ? Math.sqrt(Math.min(Iy_mm4, Iz_mm4) / A_mm2) : undefined;

    // H-section missing props derivation from shape (H/B/tw/tf)
    let derivedWnxMm3 = Wx_mm3;
    let derivedS_mm3 = S_mm3;
    let derivedTw_mm = tw_mm;
    let derivedAs_mm2 = As_mm2;
    if (sectionShape && sectionShape['kind'] === 'H') {
      const H = Number(sectionShape['H'] ?? 0);
      const B = Number(sectionShape['B'] ?? 0);
      const tw = Number(sectionShape['tw'] ?? 0);
      const tf = Number(sectionShape['tf'] ?? 0);
      if (H > 0 && B > 0 && tw > 0 && tf > 0) {
        // convert m → mm
        const Hmm = H * 1000, Bmm = B * 1000, twmm = tw * 1000, tfmm = tf * 1000;
        const hw = Hmm - 2 * tfmm;
        if (derivedWnxMm3 <= 0) {
          // Iy = (tw*hw³)/12 + 2*B*tf*((hw+tf)/2)² — already have Iy_mm4 from props
          // Wx = Iy / (H/2)
          derivedWnxMm3 = Iy_mm4 > 0 ? Iy_mm4 / (Hmm / 2) : 0;
        }
        if (derivedS_mm3 <= 0) {
          // S = B*tf*(hw+tf)/2 + tw*(hw/2)²/2
          const S_flange = Bmm * tfmm * (hw + tfmm) / 2;
          const S_web = twmm * (hw / 2) * (hw / 4);
          derivedS_mm3 = S_flange + S_web;
        }
        if (derivedTw_mm <= 0) {
          derivedTw_mm = twmm;
        }
        if (derivedAs_mm2 <= 0) {
          derivedAs_mm2 = twmm * hw;
        }
      }
    }

    // material: fy→f/fv fallback for gb50017 (steel design strength)
    const materialWithDesign: Record<string, unknown> = ((): Record<string, unknown> => {
      if (!materialObj) return {};
      const base = { ...materialObj };
      const fy = typeof materialObj['fy'] === 'number' ? materialObj['fy'] : undefined;
      const hasF = typeof materialObj['f'] === 'number';
      const hasFv = typeof materialObj['fv'] === 'number';
      if (!hasF && fy !== undefined) {
        base['f'] = fy; // conservative: use fy as design strength (f ≤ fy)
      }
      if (!hasFv && fy !== undefined) {
        base['fv'] = Math.round(fy / Math.sqrt(3) * 100) / 100; // fv ≈ 0.577·fy
      }
      return base;
    })();

    // design parameters from element metadata (phi, lambda limits, etc.)
    const elemMetadata = (typeof elem['metadata'] === 'object' && elem['metadata'] !== null
      ? elem['metadata'] as Record<string, unknown> : {}) as Record<string, unknown>;

    elementData[elemId] = {
      type: elem['type'],
      section: {
        A: A_mm2,
        ...(Iy_mm4 > 0 ? { I: Iy_mm4 } : {}),
        ...(Iz_mm4 > 0 ? { Iz: Iz_mm4 } : {}),
        ...(J_mm4 > 0 ? { J: J_mm4 } : {}),
        ...(i_min !== undefined ? { i: i_min } : {}),
        ...(derivedWnxMm3 > 0 ? { Wx: derivedWnxMm3, Wnx: derivedWnxMm3 } : {}),
        ...(derivedS_mm3 > 0 ? { S: derivedS_mm3 } : {}),
        ...(derivedTw_mm > 0 ? { tw: derivedTw_mm } : {}),
        ...(derivedAs_mm2 > 0 ? { As: derivedAs_mm2 } : {}),
        ...(sectionObj?.['width'] !== undefined ? { width: sectionObj?.['width'] } : {}),
        ...(sectionObj?.['height'] !== undefined ? { height: sectionObj?.['height'] } : {}),
        ...(typeof sectionProps['G'] === 'number' ? { G: sectionProps['G'] } : {}),
        ...(sectionShape ? { shape: sectionShape } : {}),
      },
      material: materialWithDesign,
      forces: {
        ...(envelopeN !== undefined ? { N: envelopeN } : {}),
        ...(envelopeV !== undefined ? { V: envelopeV } : {}),
        ...(envelopeMx !== undefined ? { Mx: envelopeMx } : {}),
      },
      ...(lengthMm !== undefined ? { length: lengthMm } : {}),
      // design parameters (optionally passed via element metadata or element itself)
      ...(typeof elem['phi'] === 'number' ? { phi: elem['phi'] } : {}),
      ...(typeof elem['phi_b'] === 'number' ? { phi_b: elem['phi_b'] } : {}),
      ...(typeof elem['phi_axial'] === 'number' ? { phi_axial: elem['phi_axial'] } : {}),
      ...(typeof elem['beta1'] === 'number' ? { beta1: elem['beta1'] } : {}),
      ...(typeof elem['btLimit'] === 'number' ? { btLimit: elem['btLimit'] } : {}),
      ...(typeof elem['lambdaLimit'] === 'number' ? { lambdaLimit: elem['lambdaLimit'] } : {}),
      ...(typeof elem['deflectionLimitN'] === 'number' ? { deflectionLimitN: elem['deflectionLimitN'] } : {}),
      ...(typeof elem['deflection'] === 'number' ? { deflection: elem['deflection'] } : {}),
      // from metadata
      ...(typeof elemMetadata['phi'] === 'number' ? { phi: elemMetadata['phi'] } : {}),
      ...(typeof elemMetadata['phi_b'] === 'number' ? { phi_b: elemMetadata['phi_b'] } : {}),
      ...(typeof elemMetadata['phi_axial'] === 'number' ? { phi_axial: elemMetadata['phi_axial'] } : {}),
    };
  }

  return elementData;
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
  const analysisUtil = extractUtilizationByElement(options.analysis);
  const postprocessedUtil = options.postprocessedResult
    ? extractUtilizationByElement(options.postprocessedResult)
    : {};
  const parameterUtil = extractUtilizationByElement(options.analysisParameters);
  const utilizationByElement = { ...analysisUtil, ...postprocessedUtil, ...parameterUtil };

  // elementData: 合并 OpenSees 内力 + 模型截面/材料, 供 Python code-check 层真算
  const elementData = extractElementDataForCodeCheck(options.model, options.analysis);

  return {
    modelId: options.traceId,
    code: options.designCode,
    elements: options.codeCheckElements?.length ? options.codeCheckElements : extractElementIds(options.model),
    context: {
      analysisSummary: extractAnalysisSummary(options.analysis),
      utilizationByElement,
      elementContextById: extractElementContextById(options.model),
      modelSummary: extractModelSummary(options.model),
      elementData,
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
