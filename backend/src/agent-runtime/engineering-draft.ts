import type {
  DraftExtraction,
  DraftLoadPosition,
  DraftLoadType,
  DraftSupportType,
  AgentAnalysisType,
  EngineeringDraft,
  EngineeringDraftLoad,
  EngineeringDraftLoadDirection,
  EngineeringDraftLoadKind,
  EngineeringDraftLoadUnit,
  FrameBaseSupportType,
  InferredModelType,
  MaterialFamily,
} from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = positiveNumber(value);
  return parsed === undefined ? undefined : Math.max(1, Math.round(parsed));
}

function positiveNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => positiveNumber(item))
    .filter((item): item is number => item !== undefined);
  return values.length ? values : undefined;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeMaterialFamily(value: unknown): MaterialFamily | undefined {
  const raw = normalizeString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (['steel', 'concrete', 'composite', 'timber', 'masonry', 'generic'].includes(raw)) {
    return raw as MaterialFamily;
  }
  return undefined;
}

function normalizeSupportType(value: unknown): DraftSupportType | undefined {
  const raw = normalizeString(value);
  if (
    raw === 'cantilever'
    || raw === 'simply-supported'
    || raw === 'fixed-fixed'
    || raw === 'fixed-pinned'
  ) {
    return raw;
  }
  return undefined;
}

function normalizeFrameBaseSupportType(value: unknown): FrameBaseSupportType | undefined {
  const raw = normalizeString(value);
  return raw === 'fixed' || raw === 'pinned' ? raw : undefined;
}

function normalizeAnalysisType(value: unknown): AgentAnalysisType | undefined {
  const raw = normalizeString(value);
  return raw === 'static' || raw === 'dynamic' || raw === 'seismic' || raw === 'nonlinear'
    ? raw
    : undefined;
}

function normalizeEngineTarget(value: unknown): 'opensees' | 'pkpm' | 'yjk' | undefined {
  const raw = normalizeString(value)?.toLowerCase();
  return raw === 'opensees' || raw === 'pkpm' || raw === 'yjk' ? raw : undefined;
}

function normalizeLoadKind(value: unknown): EngineeringDraftLoadKind | undefined {
  const raw = normalizeString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === 'point' || raw === 'nodal' || raw === 'area' || raw === 'distributed') {
    return raw;
  }
  if (raw === 'line' || raw === 'uniform' || raw === 'udl') {
    return 'line';
  }
  return undefined;
}

function normalizeLoadUnit(value: unknown, kind: EngineeringDraftLoadKind): EngineeringDraftLoadUnit {
  const raw = normalizeString(value)?.toLowerCase().replace(/\s+/g, '');
  if (raw === 'kn/m2' || raw === 'kn/m^2' || raw === 'kn/㎡' || raw === 'kn/m²') {
    return 'kN/m2';
  }
  if (raw === 'kn/m') {
    return 'kN/m';
  }
  if (raw === 'kn') {
    return 'kN';
  }
  if (kind === 'line' || kind === 'distributed') return 'kN/m';
  if (kind === 'area') return 'kN/m2';
  return 'kN';
}

function normalizeLoadDirection(value: unknown): EngineeringDraftLoadDirection | undefined {
  const raw = normalizeString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === 'gravity' || raw === 'vertical' || raw === 'downward') return 'gravity';
  if (raw === 'globalx' || raw === 'x' || raw === 'fx') return 'globalX';
  if (raw === 'globaly' || raw === 'y' || raw === 'fy') return 'globalY';
  if (raw === 'globalz' || raw === 'z' || raw === 'fz') return 'globalZ';
  return undefined;
}

function normalizeLoadLocation(value: unknown): EngineeringDraftLoad['location'] | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const location = {
    xM: positiveNumber(raw.xM ?? raw.x ?? raw.positionM),
    spanIndex: positiveInteger(raw.spanIndex ?? raw.span),
    nodeRole: normalizeString(raw.nodeRole ?? raw.node),
  };
  return location.xM !== undefined || location.spanIndex !== undefined || location.nodeRole !== undefined
    ? location
    : undefined;
}

function normalizeEngineeringLoad(value: unknown): EngineeringDraftLoad | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const kind = normalizeLoadKind(raw.kind ?? raw.type ?? raw.loadType);
  const magnitude = positiveNumber(raw.magnitude ?? raw.value ?? raw.loadKN ?? raw.forceKN ?? raw.intensity);
  if (!kind || magnitude === undefined) return undefined;
  return {
    kind,
    magnitude,
    unit: normalizeLoadUnit(raw.unit, kind),
    direction: normalizeLoadDirection(raw.direction ?? raw.axis),
    target: normalizeString(raw.target),
    location: normalizeLoadLocation(raw.location),
  };
}

export function normalizeEngineeringDraft(value: unknown): EngineeringDraft | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const rawGeometry = asRecord(raw.geometry);
  const geometry = rawGeometry ? {
    lengthM: positiveNumber(rawGeometry.lengthM),
    heightM: positiveNumber(rawGeometry.heightM),
    spanLengthsM: positiveNumberArray(rawGeometry.spanLengthsM),
    storyHeightsM: positiveNumberArray(rawGeometry.storyHeightsM),
    bayWidthsM: positiveNumberArray(rawGeometry.bayWidthsM),
    bayWidthsXM: positiveNumberArray(rawGeometry.bayWidthsXM),
    bayWidthsYM: positiveNumberArray(rawGeometry.bayWidthsYM),
  } : undefined;

  const rawMaterial = asRecord(raw.material);
  const material = rawMaterial ? {
    family: normalizeMaterialFamily(rawMaterial.family),
    grade: normalizeString(rawMaterial.grade),
    rebarGrade: normalizeString(rawMaterial.rebarGrade),
  } : undefined;

  const rawSections = asRecord(raw.sections);
  const sections = rawSections ? {
    beam: normalizeString(rawSections.beam),
    column: normalizeString(rawSections.column),
    member: normalizeString(rawSections.member),
  } : undefined;

  const rawBoundary = asRecord(raw.boundary);
  const boundary = rawBoundary ? {
    supportType: normalizeSupportType(rawBoundary.supportType),
    frameBaseSupportType: normalizeFrameBaseSupportType(rawBoundary.frameBaseSupportType),
  } : undefined;

  const loads = Array.isArray(raw.loads)
    ? raw.loads.map(normalizeEngineeringLoad).filter((load): load is EngineeringDraftLoad => load !== undefined)
    : undefined;

  const rawAnalysis = asRecord(raw.analysis);
  const analysis = rawAnalysis ? {
    type: normalizeAnalysisType(rawAnalysis.type),
    engineTarget: normalizeEngineTarget(rawAnalysis.engineTarget),
  } : undefined;

  const draft: EngineeringDraft = {
    structureType: normalizeString(raw.structureType) as EngineeringDraft['structureType'],
    geometry,
    material,
    sections,
    boundary,
    loads,
    analysis,
  };

  return Object.values(draft).some((item) => item !== undefined) ? draft : undefined;
}

export function mergeEngineeringDraft(
  existing: EngineeringDraft | undefined,
  patch: EngineeringDraft | undefined,
): EngineeringDraft | undefined {
  if (!existing) return patch;
  if (!patch) return existing;
  return {
    structureType: patch.structureType ?? existing.structureType,
    geometry: { ...(existing.geometry ?? {}), ...(patch.geometry ?? {}) },
    material: { ...(existing.material ?? {}), ...(patch.material ?? {}) },
    sections: { ...(existing.sections ?? {}), ...(patch.sections ?? {}) },
    boundary: { ...(existing.boundary ?? {}), ...(patch.boundary ?? {}) },
    loads: patch.loads?.length ? patch.loads : existing.loads,
    analysis: { ...(existing.analysis ?? {}), ...(patch.analysis ?? {}) },
  };
}

function isLineLoad(load: EngineeringDraftLoad): boolean {
  return load.kind === 'line' || load.kind === 'distributed' || load.unit === 'kN/m';
}

function isPointLikeLoad(load: EngineeringDraftLoad): boolean {
  return load.kind === 'point' || load.kind === 'nodal' || load.unit === 'kN';
}

function legacyLoadType(load: EngineeringDraftLoad): DraftLoadType {
  return isLineLoad(load) ? 'distributed' : 'point';
}

function legacyLoadPosition(load: EngineeringDraftLoad): DraftLoadPosition {
  if (isLineLoad(load)) return 'full-span';
  const role = load.location?.nodeRole?.toLowerCase();
  if (role?.includes('top')) return 'top-nodes';
  if (load.location?.xM !== undefined) return 'free-joint';
  return 'midspan';
}

function targetIncludes(load: EngineeringDraftLoad, text: string): boolean {
  return (load.target ?? '').toLowerCase().includes(text);
}

function modelLoadDirection(load: EngineeringDraftLoad): 'fx' | 'fy' | 'fz' {
  if (load.direction === 'globalX') return 'fx';
  if (load.direction === 'globalY') return 'fy';
  return 'fz';
}

function signedNodalComponent(load: EngineeringDraftLoad): Record<string, number> {
  const component = modelLoadDirection(load);
  const sign = component === 'fz' ? -1 : 1;
  return { [`${component}KN`]: sign * load.magnitude };
}

function firstLoad(loads: EngineeringDraftLoad[] | undefined): EngineeringDraftLoad | undefined {
  return loads?.find((load) => isLineLoad(load)) ?? loads?.find((load) => isPointLikeLoad(load));
}

function sectionDimensionsM(section: string | undefined): { sectionWidthM?: number; sectionDepthM?: number } {
  if (!section) return {};
  const match = section.match(/([0-9]+(?:\.[0-9]+)?)\s*[xX×*]\s*([0-9]+(?:\.[0-9]+)?)/u);
  if (!match?.[1] || !match[2]) return {};
  const width = Number(match[1]);
  const depth = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return {};
  const scale = width > 20 || depth > 20 ? 1000 : 1;
  return {
    sectionWidthM: width / scale,
    sectionDepthM: depth / scale,
  };
}

export function projectEngineeringDraftToLegacyPatch(
  patch: DraftExtraction,
  inferredType: InferredModelType,
): DraftExtraction {
  const engineeringDraft = patch.engineeringDraft;
  if (!engineeringDraft) return patch;

  const loads = engineeringDraft.loads ?? [];
  const primaryLoad = firstLoad(loads);
  const spanLengths = engineeringDraft.geometry?.spanLengthsM;
  const skillState: Record<string, unknown> = {
    ...(patch.skillState ?? {}),
    engineeringDraft,
    extractionSource: 'engineering-draft',
  };
  const next: DraftExtraction = {
    ...patch,
    inferredType,
    engineeringDraft,
    skillState,
  };

  if (engineeringDraft.geometry?.lengthM !== undefined) next.lengthM = next.lengthM ?? engineeringDraft.geometry.lengthM;
  if (engineeringDraft.geometry?.heightM !== undefined) next.heightM = next.heightM ?? engineeringDraft.geometry.heightM;
  if (engineeringDraft.boundary?.supportType !== undefined) next.supportType = next.supportType ?? engineeringDraft.boundary.supportType;
  if (engineeringDraft.boundary?.frameBaseSupportType !== undefined) {
    next.frameBaseSupportType = next.frameBaseSupportType ?? engineeringDraft.boundary.frameBaseSupportType;
  }
  if (primaryLoad) {
    next.loadKN = next.loadKN ?? primaryLoad.magnitude;
    next.loadType = next.loadType ?? legacyLoadType(primaryLoad);
    next.loadPosition = next.loadPosition ?? legacyLoadPosition(primaryLoad);
    if (primaryLoad.location?.xM !== undefined) {
      next.loadPositionM = next.loadPositionM ?? primaryLoad.location.xM;
    }
  }

  if (inferredType === 'beam') {
    if (next.lengthM === undefined && spanLengths?.length) {
      next.lengthM = spanLengths.reduce((total, span) => total + span, 0);
    }
    skillState.beamLoads = loads.map((load) => ({
      kind: isLineLoad(load) ? 'distributed' : 'point',
      magnitude: load.magnitude,
      unit: load.unit,
      direction: load.direction,
      target: load.target,
      xM: load.location?.xM,
      spanIndex: load.location?.spanIndex,
    }));
  }

  if (inferredType === 'truss') {
    if (next.lengthM === undefined && spanLengths?.length) {
      next.lengthM = spanLengths.reduce((total, span) => total + span, 0);
    }
    if (engineeringDraft.geometry?.heightM !== undefined) {
      next.heightM = next.heightM ?? engineeringDraft.geometry.heightM;
    }
    if (next.bayCount === undefined && spanLengths?.length) {
      next.bayCount = spanLengths.length;
    }
  }

  if (inferredType === 'frame') {
    const geometry = engineeringDraft.geometry;
    if (geometry?.storyHeightsM?.length) {
      next.storyHeightsM = next.storyHeightsM ?? geometry.storyHeightsM;
      next.storyCount = next.storyCount ?? geometry.storyHeightsM.length;
    }
    if (geometry?.bayWidthsM?.length) {
      next.bayWidthsM = next.bayWidthsM ?? geometry.bayWidthsM;
      next.bayCount = next.bayCount ?? geometry.bayWidthsM.length;
      next.frameDimension = next.frameDimension ?? '2d';
    }
    if (geometry?.bayWidthsXM?.length) {
      next.bayWidthsXM = next.bayWidthsXM ?? geometry.bayWidthsXM;
      next.bayCountX = next.bayCountX ?? geometry.bayWidthsXM.length;
      next.frameDimension = next.frameDimension ?? '3d';
    }
    if (geometry?.bayWidthsYM?.length) {
      next.bayWidthsYM = next.bayWidthsYM ?? geometry.bayWidthsYM;
      next.bayCountY = next.bayCountY ?? geometry.bayWidthsYM.length;
      next.frameDimension = next.frameDimension ?? '3d';
    }
    if (!next.bayWidthsM?.length && spanLengths?.length) {
      next.bayWidthsM = spanLengths;
      next.bayCount = spanLengths.length;
      next.frameDimension = next.frameDimension ?? '2d';
    }
    if (engineeringDraft.material?.family === 'concrete' && engineeringDraft.material.grade) {
      next.frameConcreteGrade = engineeringDraft.material.grade;
    } else if (engineeringDraft.material?.grade) {
      next.frameMaterial = engineeringDraft.material.grade;
    }
    if (engineeringDraft.material?.rebarGrade) {
      next.frameRebarGrade = engineeringDraft.material.rebarGrade;
    }
    if (engineeringDraft.sections?.column) {
      next.frameColumnSection = engineeringDraft.sections.column;
    }
    if (engineeringDraft.sections?.beam) {
      next.frameBeamSection = engineeringDraft.sections.beam;
    }
    const gravityStoryLoad = loads.find((load) => load.direction === 'gravity' || load.direction === 'globalZ' || load.direction === undefined);
    const lateralXLoad = loads.find((load) => load.direction === 'globalX');
    const lateralYLoad = loads.find((load) => load.direction === 'globalY');
    const storyCount = next.storyCount ?? next.storyHeightsM?.length;
    if (storyCount && (gravityStoryLoad || lateralXLoad || lateralYLoad)) {
      next.floorLoads = next.floorLoads ?? Array.from({ length: storyCount }, (_, index) => ({
        story: index + 1,
        verticalKN: gravityStoryLoad?.unit === 'kN' ? gravityStoryLoad.magnitude : undefined,
        lateralXKN: lateralXLoad?.unit === 'kN' ? lateralXLoad.magnitude : undefined,
        lateralYKN: lateralYLoad?.unit === 'kN' ? lateralYLoad.magnitude : undefined,
      }));
    }
  }

  if (inferredType === 'column') {
    const section = engineeringDraft.sections?.column ?? engineeringDraft.sections?.member;
    Object.assign(skillState, sectionDimensionsM(section));
    if (engineeringDraft.material?.family === 'steel' || engineeringDraft.material?.family === 'concrete') {
      skillState.materialFamily = engineeringDraft.material.family;
    }
    const columnLoads = loads
      .filter((load) => isPointLikeLoad(load))
      .map((load) => signedNodalComponent(load));
    if (columnLoads.length) {
      skillState.columnLoads = columnLoads;
    }
    if (next.lengthM === undefined && next.heightM !== undefined) next.lengthM = next.heightM;
    if (next.heightM === undefined && next.lengthM !== undefined) next.heightM = next.lengthM;
    const axial = columnLoads.find((load) => typeof load.fzKN === 'number') as { fzKN?: number } | undefined;
    if (axial?.fzKN !== undefined) {
      next.loadKN = Math.abs(axial.fzKN);
      next.loadType = 'point';
      next.loadPosition = 'top-nodes';
    }
  }

  if (inferredType === 'double-span-beam') {
    if (spanLengths?.length) {
      next.spanLengthM = next.spanLengthM ?? spanLengths[0];
      skillState.spanLengthsM = spanLengths;
      skillState.spanCount = spanLengths.length;
    }
    const lineLoad = loads.find(isLineLoad);
    if (lineLoad) {
      skillState.distributedLoadKNM = lineLoad.magnitude;
      next.loadKN = next.loadKN ?? lineLoad.magnitude;
      next.loadType = next.loadType ?? 'distributed';
      next.loadPosition = next.loadPosition ?? 'full-span';
    }
    const pointLoad = loads.find((load) => isPointLikeLoad(load) && !isLineLoad(load));
    if (pointLoad) {
      skillState.pointLoadKN = pointLoad.magnitude;
      if (pointLoad.location?.spanIndex !== undefined) skillState.pointLoadSpanIndex = pointLoad.location.spanIndex;
      if (pointLoad.location?.xM !== undefined) skillState.pointLoadXM = pointLoad.location.xM;
    }
  }

  if (inferredType === 'portal-frame') {
    if (spanLengths?.length) {
      next.spanLengthM = next.spanLengthM ?? spanLengths[0];
      skillState.portalBaySpansM = spanLengths;
      skillState.portalBayCount = spanLengths.length;
    }
    const roofLoad = loads.find((load) => isLineLoad(load) && (targetIncludes(load, 'roof') || targetIncludes(load, 'rafter')))
      ?? loads.find(isLineLoad);
    if (roofLoad) {
      skillState.roofLoadKNM = roofLoad.magnitude;
      next.loadKN = next.loadKN ?? roofLoad.magnitude;
      next.loadType = next.loadType ?? 'distributed';
      next.loadPosition = next.loadPosition ?? 'full-span';
    }
    const craneLoad = loads.find((load) => targetIncludes(load, 'crane'));
    if (craneLoad) {
      skillState.craneLoadKN = craneLoad.magnitude;
    }
  }

  return next;
}
