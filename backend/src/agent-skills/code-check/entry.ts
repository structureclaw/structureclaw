import {
  resolveCodeCheckRule,
} from './registry.js';
import type { CodeCheckDomainInput } from './types.js';
import type { CodeCheckClient } from './rule.js';
import type { ExecutionRequestOptions } from '../analysis/types.js';
import { withGB50011CodeCheckMetadata } from './gb50011/metadata.js';

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
  const root = asRecord(analysis);
  const nestedData = asRecord(root['data']);
  const data = Object.keys(nestedData).length > 0 ? nestedData : root;
  return {
    analysisType: root['analysis_type'],
    success: root['success'],
    errorCode: root['error_code'],
    message: root['message'],
    analysisMode: data['analysisMode'],
    workflowInputMode: data['workflowInputMode'] ?? root['workflowInputMode'],
    summary: data['summary'],
    envelope: data['envelope'],
    modelSummary: data['modelSummary'],
    designBasis: data['designBasis'],
    methodDecision: data['methodDecision'],
    regularityAssessment: data['regularityAssessment'],
    specialSystemReview: data['specialSystemReview'],
    overLimitReview: data['overLimitReview'],
    specialReview: data['specialReview'],
    specialSeismicReview: data['specialSeismicReview'],
    overLimitSpecialReview: data['overLimitSpecialReview'],
    responseSpectrum: data['responseSpectrum'],
    timeHistory: data['timeHistory'],
    elasticPlasticTimeHistory: data['elasticPlasticTimeHistory'],
    seismicDesignActions: data['seismicDesignActions'],
    gravityDesignActions: data['gravityDesignActions'],
    memberDesignActionCombinations: data['memberDesignActionCombinations'],
    verticalSeismic: data['verticalSeismic'],
    groundMotionRequirement: data['groundMotionRequirement'],
    directionResults: data['directionResults'],
    pushover: data['pushover'],
    missingInputs: data['missingInputs'],
    missingCapabilities: data['missingCapabilities'],
    capabilityAssessment: data['capabilityAssessment'],
    isPreliminary: data['isPreliminary'],
    warnings: data['warnings'],
  };
}

function isGB50011DesignCode(code: string): boolean {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
  return normalized === 'GB50011'
    || normalized === 'GB50011-2010'
    || normalized === 'GBT50011'
    || normalized === 'GB/T50011'
    || normalized === 'GBT50011-2010'
    || normalized === 'GB/T50011-2010'
    || normalized === 'GBT50011-2010-2024'
    || normalized === 'GB/T50011-2010-2024'
    || normalized === 'GB55002+GBT50011'
    || normalized === 'GB55002+GB/T50011';
}

function hasSeismicAnalysisResult(analysis: unknown): boolean {
  const root = asRecord(analysis);
  const nestedData = asRecord(root['data']);
  const data = Object.keys(nestedData).length > 0 ? nestedData : root;
  return data['analysisMode'] === 'opensees_china_seismic_workflow'
    || Boolean(data['designBasis'] && data['methodDecision'] && data['envelope']);
}

function appendGlobalSeismicElement(elements: string[], designCode: string, analysis: unknown): string[] {
  if (!isGB50011DesignCode(designCode) || !hasSeismicAnalysisResult(analysis)) {
    return elements;
  }
  return elements.includes('__global_seismic__')
    ? elements
    : ['__global_seismic__', ...elements];
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
    const metadata = asRecord(element['metadata']);
    const extra = asRecord(element['extra']);
    const structuredMemberSources = [element, metadata, extra];
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
      seismicGrade: element['seismic_grade'],
      storyHeightMm: pickFirstDefined(structuredMemberSources, ['storyHeightMm', 'floorHeightMm', 'heightBetweenFloorsMm']),
      storyHeight: pickFirstDefined(structuredMemberSources, ['storyHeight', 'floorHeight', 'heightBetweenFloors']),
      reinforcement: pickFirstDefined(structuredMemberSources, ['reinforcement']),
      shearWall: pickFirstDefined(structuredMemberSources, ['shearWall']),
      seismicWall: pickFirstDefined(structuredMemberSources, ['seismicWall']),
      wallData: pickFirstDefined(structuredMemberSources, ['wallData']),
      shearWallData: pickFirstDefined(structuredMemberSources, ['shearWallData']),
      boundaryElement: pickFirstDefined(structuredMemberSources, ['boundaryElement', 'boundaryMember', 'edgeMember']),
      boundaryElements: pickFirstDefined(structuredMemberSources, ['boundaryElements', 'boundaryMembers', 'edgeMembers']),
      seismicCapacity: pickFirstDefined(structuredMemberSources, ['seismicCapacity']),
      capacityDesign: pickFirstDefined(structuredMemberSources, ['capacityDesign']),
      strongShearWeakBending: pickFirstDefined(structuredMemberSources, ['strongShearWeakBending']),
      shearCompression: pickFirstDefined(structuredMemberSources, ['shearCompression', 'shearCompressionLimit', 'shearCompressionCheck']),
      jointCore: pickFirstDefined(structuredMemberSources, ['jointCore', 'jointCoreStirrup', 'jointCoreStirrups']),
      jointData: pickFirstDefined(structuredMemberSources, ['jointData', 'beamJointData']),
      flatBeam: pickFirstDefined(structuredMemberSources, ['flatBeam', 'wideBeam']),
      columnPosition: pickFirstDefined(structuredMemberSources, ['columnPosition']),
      columnCategory: pickFirstDefined(structuredMemberSources, ['columnCategory']),
      steelSeismicDetailing: pickFirstDefined(structuredMemberSources, ['steelSeismicDetailing', 'steelSeismicChecks']),
      steelDetailing: pickFirstDefined(structuredMemberSources, ['steelDetailing']),
      seismicDetailing: pickFirstDefined(structuredMemberSources, ['seismicDetailing', 'seismicDetailingChecks']),
      extra: element['extra'],
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

function isPkpmAnalysisResult(analysis: Record<string, unknown>, data: Record<string, unknown>): boolean {
  const meta = asRecord(analysis['meta']);
  return data['analysisMode'] === 'pkpm-satwe'
    || meta['analysisAdapterKey'] === 'builtin-pkpm'
    || meta['engineId'] === 'builtin-pkpm';
}

function usesKilonewtonAnalysisForceUnits(analysis: Record<string, unknown>, data: Record<string, unknown>): boolean {
  const meta = asRecord(analysis['meta']);
  return isPkpmAnalysisResult(analysis, data)
    || meta['analysisAdapterKey'] === 'builtin-opensees'
    || meta['engineId'] === 'builtin-opensees';
}

function scaleFiniteNumber(value: unknown, factor: number): unknown {
  return typeof value === 'number' && Number.isFinite(value) ? value * factor : value;
}

function convertKilonewtonForcesToCodeCheckUnits(forceRecord: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...forceRecord };
  for (const key of ['N', 'V', 'Vy', 'Vz']) {
    if (key in next) next[key] = scaleFiniteNumber(next[key], 1000);
  }
  for (const key of ['M', 'Mx', 'My', 'Mz', 'T']) {
    if (key in next) next[key] = scaleFiniteNumber(next[key], 1000000);
  }
  for (const key of ['n1', 'n2']) {
    const nested = asRecord(next[key]);
    if (Object.keys(nested).length > 0) {
      next[key] = convertKilonewtonForcesToCodeCheckUnits(nested);
    }
  }
  return next;
}

function sectionShapeDimensionToMm(value: unknown, sourceUnit: 'm' | 'mm'): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return sourceUnit === 'mm' ? numeric : numeric * 1000;
}

function hasRecordKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function pickFirstDefined(sources: Array<Record<string, unknown>>, keys: string[]): unknown {
  for (const source of sources) {
    for (const key of keys) {
      if (source[key] !== undefined) {
        return source[key];
      }
    }
  }
  return undefined;
}

/**
 * 从模型和分析结果中提取 elementData，供 Python code-check 层消费。
 *
 * 合并三项数据源:
 *   1. model.elements[] — 构件类型、截面/材料 ID、始末节点
 *   2. model.sections[] / model.materials[] — 截面/材料属性
 *   3. analysisResult.data.forces[] — 每构件内力；PKPM/OpenSees 的 kN/kN·m 会转为 N/N·mm
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

  // unwrap AnalysisResponse: { data: { forces: { ... } } }; direct result objects are also accepted.
  const analysis = asRecord(analysisResult);
  const dataObject = asRecord(analysis['data']);
  const data = Object.keys(dataObject).length > 0 ? dataObject : analysis;
  const rawForces = data?.['forces'] as Record<string, unknown> | undefined;
  const shouldConvertForceUnits = usesKilonewtonAnalysisForceUnits(analysis, data);
  const forces: Record<string, Record<string, unknown>> = {};
  if (rawForces) {
    for (const [elemId, value] of Object.entries(rawForces)) {
      if (value && typeof value === 'object') {
        const forceRecord = value as Record<string, unknown>;
        forces[elemId] = shouldConvertForceUnits
          ? convertKilonewtonForcesToCodeCheckUnits(forceRecord)
          : forceRecord;
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
    const sectionProps = asRecord(sectionObj?.['properties']);
    const sectionExtra = asRecord(sectionObj?.['extra']);
    const sectionShapeRecord = asRecord(sectionObj?.['shape']);
    const sectionShape = hasRecordKeys(sectionShapeRecord) ? sectionShapeRecord : undefined;

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
      const rawH = Number(sectionShape['H'] ?? 0);
      const rawB = Number(sectionShape['B'] ?? 0);
      const shapeUnit = rawH > 10 || rawB > 10 ? 'mm' : 'm';
      const Hmm = sectionShapeDimensionToMm(sectionShape['H'], shapeUnit);
      const Bmm = sectionShapeDimensionToMm(sectionShape['B'], shapeUnit);
      const twmm = sectionShapeDimensionToMm(sectionShape['tw'], shapeUnit);
      const tfmm = sectionShapeDimensionToMm(sectionShape['tf'], shapeUnit);
      if (Hmm > 0 && Bmm > 0 && twmm > 0 && tfmm > 0) {
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
    const elemExtra = asRecord(elem['extra']);
    const structuralSources = [
      elem,
      elemMetadata,
      elemExtra,
      sectionObj ?? {},
      sectionExtra,
      sectionProps,
      sectionShape ?? {},
    ];
    const wallThickness = pickFirstDefined(structuralSources, [
      'thicknessMm',
      'wallThicknessMm',
      'tMm',
      'thickness',
      'wallThickness',
      't',
      'T',
    ]);
    const wallLength = pickFirstDefined(structuralSources, [
      'wallLengthMm',
      'wallLengthM',
      'wallLength',
      'wall_length',
      'length',
      'L',
    ]);
    const sectionReinforcement = pickFirstDefined([sectionObj ?? {}, sectionExtra, sectionProps], ['reinforcement']);
    const reinforcement = pickFirstDefined(
      [elem, elemMetadata, elemExtra, sectionObj ?? {}, sectionExtra, sectionProps],
      ['reinforcement'],
    );
    const shearWall = pickFirstDefined(structuralSources, ['shearWall']);
    const seismicWall = pickFirstDefined(structuralSources, ['seismicWall']);
    const wallData = pickFirstDefined(structuralSources, ['wallData']);
    const shearWallData = pickFirstDefined(structuralSources, ['shearWallData']);
    const boundaryElement = pickFirstDefined(structuralSources, ['boundaryElement', 'boundaryMember', 'edgeMember']);
    const boundaryElements = pickFirstDefined(structuralSources, ['boundaryElements', 'boundaryMembers', 'edgeMembers']);
    const storyHeightMm = pickFirstDefined(structuralSources, ['storyHeightMm', 'floorHeightMm', 'heightBetweenFloorsMm']);
    const storyHeight = pickFirstDefined(structuralSources, ['storyHeight', 'floorHeight', 'heightBetweenFloors']);
    const seismicCapacity = pickFirstDefined(structuralSources, ['seismicCapacity']);
    const capacityDesign = pickFirstDefined(structuralSources, ['capacityDesign']);
    const strongShearWeakBending = pickFirstDefined(structuralSources, [
      'strongShearWeakBending',
      'strongShearWeakFlexure',
      'strongShearWeakMoment',
      'shearBendingCapacityDesign',
      'capacityDesignShear',
    ]);
    const shearCompression = pickFirstDefined(structuralSources, [
      'shearCompression',
      'shearCompressionLimit',
      'shearCompressionCheck',
      'seismicShearCompression',
      'seismicShearCompressionLimit',
      'seismicShearCompressionCheck',
    ]);
    const jointCore = pickFirstDefined(structuralSources, ['jointCore', 'jointCoreStirrup', 'jointCoreStirrups', 'coreJoint', 'beamColumnJoint']);
    const jointData = pickFirstDefined(structuralSources, ['jointData', 'beamJointData', 'connection']);
    const flatBeam = pickFirstDefined(structuralSources, ['flatBeam', 'wideBeam']);
    const columnPosition = pickFirstDefined(structuralSources, ['columnPosition']);
    const columnCategory = pickFirstDefined(structuralSources, ['columnCategory']);
    const steelSeismicDetailing = pickFirstDefined(structuralSources, [
      'steelSeismicDetailing',
      'steelSeismicChecks',
      'steelDetailing',
      'seismicDetailing',
      'seismicDetailingChecks',
    ]);
    const steelSlenderness = pickFirstDefined(structuralSources, ['slenderness']);
    const steelWidthThickness = pickFirstDefined(structuralSources, ['widthThickness']);

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
        ...(wallThickness !== undefined ? { wallThickness } : {}),
        ...(wallLength !== undefined ? { wallLength } : {}),
        ...(sectionObj?.['thickness'] !== undefined ? { thickness: sectionObj?.['thickness'] } : {}),
        ...(sectionReinforcement !== undefined ? { reinforcement: sectionReinforcement } : {}),
        ...(sectionProps && hasRecordKeys(sectionProps) ? { properties: sectionProps } : {}),
        ...(sectionExtra && hasRecordKeys(sectionExtra) ? { extra: sectionExtra } : {}),
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
      ...(elem['seismic_grade'] !== undefined ? { seismicGrade: elem['seismic_grade'] } : {}),
      ...(storyHeightMm !== undefined ? { storyHeightMm } : {}),
      ...(storyHeight !== undefined ? { storyHeight } : {}),
      ...(reinforcement !== undefined ? { reinforcement } : {}),
      ...(shearWall !== undefined ? { shearWall } : {}),
      ...(seismicWall !== undefined ? { seismicWall } : {}),
      ...(wallData !== undefined ? { wallData } : {}),
      ...(shearWallData !== undefined ? { shearWallData } : {}),
      ...(boundaryElement !== undefined ? { boundaryElement } : {}),
      ...(boundaryElements !== undefined ? { boundaryElements } : {}),
      ...(seismicCapacity !== undefined ? { seismicCapacity } : {}),
      ...(capacityDesign !== undefined ? { capacityDesign } : {}),
      ...(strongShearWeakBending !== undefined ? { strongShearWeakBending } : {}),
      ...(shearCompression !== undefined ? { shearCompression } : {}),
      ...(jointCore !== undefined ? { jointCore } : {}),
      ...(jointData !== undefined ? { jointData } : {}),
      ...(flatBeam !== undefined ? { flatBeam } : {}),
      ...(columnPosition !== undefined ? { columnPosition } : {}),
      ...(columnCategory !== undefined ? { columnCategory } : {}),
      ...(steelSeismicDetailing !== undefined ? { steelSeismicDetailing } : {}),
      ...(steelSlenderness !== undefined ? { slenderness: steelSlenderness } : {}),
      ...(steelWidthThickness !== undefined ? { widthThickness: steelWidthThickness } : {}),
      ...(hasRecordKeys(elemExtra) ? { extra: elemExtra } : {}),
      // from metadata — steel design params
    ...(typeof elemMetadata['phi'] === 'number' ? { phi: elemMetadata['phi'] } : {}),
    ...(typeof elemMetadata['phi_b'] === 'number' ? { phi_b: elemMetadata['phi_b'] } : {}),
    ...(typeof elemMetadata['phi_axial'] === 'number' ? { phi_axial: elemMetadata['phi_axial'] } : {}),
    // from metadata — concrete rebar design (§9.2.1 / §9.3.1)
    ...(typeof elemMetadata['As'] === 'number' ? { As: elemMetadata['As'] } : {}),
    ...(typeof elemMetadata['Asv'] === 'number' ? { Asv: elemMetadata['Asv'] } : {}),
    ...(typeof elemMetadata['stirrup_dia'] === 'number' ? { stirrup_dia: elemMetadata['stirrup_dia'] } : {}),
    ...(typeof elemMetadata['stirrup_spacing'] === 'number' ? { stirrup_spacing: elemMetadata['stirrup_spacing'] } : {}),
    ...(typeof elemMetadata['main_dia'] === 'number' ? { main_dia: elemMetadata['main_dia'] } : {}),
    ...(typeof elemMetadata['bar_count'] === 'number' ? { bar_count: elemMetadata['bar_count'] } : {}),
    ...(typeof elemMetadata['sn'] === 'number' ? { sn: elemMetadata['sn'] } : {}),
    ...(typeof elemMetadata['cover'] === 'number' ? { cover: elemMetadata['cover'] } : {}),
    ...(typeof elemMetadata['crack_cover'] === 'number' ? { crack_cover: elemMetadata['crack_cover'] } : {}),
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

  const elements = options.codeCheckElements?.length ? options.codeCheckElements : extractElementIds(options.model);
  const context: CodeCheckDomainInput['context'] = {
    analysisSummary: extractAnalysisSummary(options.analysis),
    utilizationByElement,
    elementContextById: extractElementContextById(options.model),
    modelSummary: extractModelSummary(options.model),
    elementData,
  };

  return {
    modelId: options.traceId,
    code: options.designCode,
    elements: appendGlobalSeismicElement(elements, options.designCode, options.analysis),
    context: isGB50011DesignCode(options.designCode)
      ? withGB50011CodeCheckMetadata(context)
      : context,
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
