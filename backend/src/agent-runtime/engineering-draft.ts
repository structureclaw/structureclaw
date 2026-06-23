import type {
  DraftExtraction,
  DraftFloorLoad,
  DraftLoadPosition,
  DraftLoadType,
  DraftSupportType,
  DraftWindParams,
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

function nonNegativeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => finiteNumber(item))
    .filter((item): item is number => item !== undefined && item >= 0);
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

function normalizeWindTerrainRoughness(value: unknown): DraftWindParams['terrainRoughness'] | undefined {
  const raw = normalizeString(value)?.toUpperCase().replace(/类$/, '');
  return raw === 'A' || raw === 'B' || raw === 'C' || raw === 'D' ? raw : undefined;
}

function normalizeWindParams(value: unknown): DraftWindParams | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const wind: DraftWindParams = {
    ...(positiveNumber(raw.basicPressureKNM2 ?? raw.basic_pressure ?? raw.basicPressure ?? raw.windPressure) !== undefined && {
      basicPressureKNM2: positiveNumber(raw.basicPressureKNM2 ?? raw.basic_pressure ?? raw.basicPressure ?? raw.windPressure),
    }),
    ...(normalizeWindTerrainRoughness(raw.terrainRoughness ?? raw.terrain_roughness) !== undefined && {
      terrainRoughness: normalizeWindTerrainRoughness(raw.terrainRoughness ?? raw.terrain_roughness),
    }),
    ...(positiveNumber(raw.shapeFactor ?? raw.shape_factor) !== undefined && {
      shapeFactor: positiveNumber(raw.shapeFactor ?? raw.shape_factor),
    }),
    ...(positiveNumber(raw.heightVariationFactor ?? raw.height_variation_factor) !== undefined && {
      heightVariationFactor: positiveNumber(raw.heightVariationFactor ?? raw.height_variation_factor),
    }),
  };
  return Object.keys(wind).length ? wind : undefined;
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
    supportPositionsM: nonNegativeNumberArray(rawBoundary.supportPositionsM),
  } : undefined;

  const loads = Array.isArray(raw.loads)
    ? raw.loads.map(normalizeEngineeringLoad).filter((load): load is EngineeringDraftLoad => load !== undefined)
    : undefined;

  const rawAnalysis = asRecord(raw.analysis);
  const analysis = rawAnalysis ? {
    type: normalizeAnalysisType(rawAnalysis.type),
    engineTarget: normalizeEngineTarget(rawAnalysis.engineTarget),
  } : undefined;

  const wind = normalizeWindParams(raw.wind ?? raw.windParams);

  const draft: EngineeringDraft = {
    structureType: normalizeString(raw.structureType) as EngineeringDraft['structureType'],
    geometry,
    material,
    sections,
    boundary,
    loads,
    wind,
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
  const wind = existing.wind || patch.wind
    ? { ...(existing.wind ?? {}), ...(patch.wind ?? {}) }
    : undefined;
  const loads = mergeEngineeringDraftLoads(existing.loads, patch.loads);
  return {
    structureType: patch.structureType ?? existing.structureType,
    geometry: { ...(existing.geometry ?? {}), ...(patch.geometry ?? {}) },
    material: { ...(existing.material ?? {}), ...(patch.material ?? {}) },
    sections: { ...(existing.sections ?? {}), ...(patch.sections ?? {}) },
    boundary: { ...(existing.boundary ?? {}), ...(patch.boundary ?? {}) },
    loads,
    wind,
    analysis: { ...(existing.analysis ?? {}), ...(patch.analysis ?? {}) },
  };
}

function stableJson(value: unknown): string {
  if (value === undefined) return '';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = record[key];
    return acc;
  }, {}));
}

function engineeringLoadMergeKey(load: EngineeringDraftLoad): string {
  return [
    load.kind,
    load.unit,
    load.direction ?? '',
    load.target ?? '',
    stableJson(load.location),
  ].join('|');
}

function mergeEngineeringDraftLoads(
  existing: EngineeringDraftLoad[] | undefined,
  patch: EngineeringDraftLoad[] | undefined,
): EngineeringDraftLoad[] | undefined {
  if (!existing?.length) return patch?.length ? patch : undefined;
  if (!patch?.length) return existing;
  const merged = new Map<string, EngineeringDraftLoad>();
  for (const load of existing) {
    merged.set(engineeringLoadMergeKey(load), load);
  }
  for (const load of patch) {
    merged.set(engineeringLoadMergeKey(load), load);
  }
  return Array.from(merged.values());
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

function sumPositive(values: number[] | undefined): number | undefined {
  if (!values?.length) return undefined;
  const total = values.reduce((acc, value) => acc + value, 0);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

function framePlanAreaM2(patch: DraftExtraction): number | undefined {
  const totalSpanX = sumPositive(patch.bayWidthsXM);
  const totalSpanY = sumPositive(patch.bayWidthsYM);
  if (totalSpanX !== undefined && totalSpanY !== undefined) {
    return totalSpanX * totalSpanY;
  }
  const totalSpan2d = sumPositive(patch.bayWidthsM) ?? totalSpanX;
  return totalSpan2d !== undefined ? totalSpan2d * totalSpan2d : undefined;
}

function frameLoadTotalKN(load: EngineeringDraftLoad, patch: DraftExtraction): number | undefined {
  if (load.unit === 'kN') return load.magnitude;
  if (load.unit === 'kN/m') {
    return undefined;
  }
  if (load.unit === 'kN/m2') {
    const areaM2 = framePlanAreaM2(patch);
    return areaM2 !== undefined ? load.magnitude * areaM2 : undefined;
  }
  return undefined;
}

function isTopStoryTarget(target: string): boolean {
  const trimmed = target.trim();
  const text = trimmed.toLowerCase();
  return text.includes('roof')
    || /屋面|屋顶|楼顶|顶层|顶楼/u.test(trimmed)
    || trimmed === '顶';
}

function parseStoryOrdinal(target: string | undefined, storyCount: number): number | undefined {
  if (!target) return undefined;
  const text = target.toLowerCase();
  if (isTopStoryTarget(target)) return storyCount;
  const numericMatch = text.match(/(?:floor|story|level)\s*([0-9]+)/i)
    ?? target.match(/第?\s*([0-9]+)\s*层/u);
  if (numericMatch?.[1]) {
    const parsed = Number.parseInt(numericMatch[1], 10);
    return parsed >= 1 && parsed <= storyCount ? parsed : undefined;
  }
  const chineseMatch = target.match(/第?\s*([一二两三四五六七八九十廿]+)\s*层/u);
  if (!chineseMatch?.[1]) return undefined;
  const table: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    廿: 20,
  };
  const raw = chineseMatch[1];
  let parsed: number | undefined;
  if (raw === '十' || raw === '廿') {
    parsed = table[raw];
  } else if (raw.startsWith('十')) {
    parsed = 10 + (table[raw[1]] ?? 0);
  } else if (raw.startsWith('廿')) {
    parsed = 20 + (table[raw[1]] ?? 0);
  } else if (raw.endsWith('十')) {
    parsed = (table[raw[0]] ?? 1) * 10;
  } else if (raw.includes('十')) {
    const [tens, ones] = raw.split('十');
    parsed = (table[tens] ?? 1) * 10 + (table[ones] ?? 0);
  } else {
    parsed = table[raw];
  }
  return parsed !== undefined && parsed >= 1 && parsed <= storyCount ? parsed : undefined;
}

function hasFloorLoadValues(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return Boolean(floorLoads?.some((load) => (
    load.verticalKN !== undefined
    || load.liveLoadKN !== undefined
    || load.lateralXKN !== undefined
    || load.lateralYKN !== undefined
  )));
}

export function mergeFrameFloorLoadValues(
  current: DraftFloorLoad[] | undefined,
  incoming: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!current?.length) return incoming;
  if (!incoming?.length) return current;
  const merged = new Map<number, DraftFloorLoad>();
  for (const load of current) {
    merged.set(load.story, { ...load });
  }
  for (const load of incoming) {
    const existing = merged.get(load.story);
    merged.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? existing?.verticalKN,
      liveLoadKN: load.liveLoadKN ?? existing?.liveLoadKN,
      lateralXKN: load.lateralXKN ?? existing?.lateralXKN,
      lateralYKN: load.lateralYKN ?? existing?.lateralYKN,
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.story - right.story);
}

function storyHeightsForWind(patch: DraftExtraction): number[] | undefined {
  const explicit = patch.storyHeightsM?.filter((height) => Number.isFinite(height) && height > 0);
  if (explicit?.length) return explicit;
  const storyCount = patch.storyCount;
  if (!storyCount || !patch.heightM || patch.heightM <= 0) return undefined;
  return Array.from({ length: storyCount }, () => patch.heightM! / storyCount);
}

export function projectWindPressureToFloorLoads(
  wind: DraftWindParams | undefined,
  patch: DraftExtraction,
): DraftFloorLoad[] | undefined {
  const pressure = positiveNumber(wind?.basicPressureKNM2);
  if (pressure === undefined) return undefined;
  const storyHeights = storyHeightsForWind(patch);
  if (!storyHeights?.length) return undefined;
  const exposedWidthM = sumPositive(patch.bayWidthsYM)
    ?? sumPositive(patch.bayWidthsM)
    ?? sumPositive(patch.bayWidthsXM);
  if (exposedWidthM === undefined) return undefined;
  const factor = (wind?.shapeFactor ?? 1) * (wind?.heightVariationFactor ?? 1);
  return storyHeights.map((height, index) => ({
    story: index + 1,
    lateralXKN: Number((pressure * factor * exposedWidthM * height).toFixed(6)),
  }));
}

function assignFloorLoadValue(
  floorLoadsByStory: Map<number, DraftFloorLoad>,
  story: number,
  field: 'verticalKN' | 'lateralXKN' | 'lateralYKN',
  value: number,
): void {
  const current = floorLoadsByStory.get(story) ?? { story };
  const previous = current[field] ?? 0;
  floorLoadsByStory.set(story, {
    ...current,
    [field]: previous + value,
  });
}

function frameFloorLoadField(load: EngineeringDraftLoad): 'verticalKN' | 'lateralXKN' | 'lateralYKN' {
  if (load.direction === 'globalX') return 'lateralXKN';
  if (load.direction === 'globalY') return 'lateralYKN';
  return 'verticalKN';
}

type ConvertibleFrameLoad = {
  load: EngineeringDraftLoad;
  index: number;
  totalKN: number;
};

function projectFrameFloorLoads(loads: EngineeringDraftLoad[], patch: DraftExtraction): DraftFloorLoad[] | undefined {
  const storyCount = patch.storyCount ?? patch.storyHeightsM?.length;
  if (!storyCount) return undefined;

  const floorLoadsByStory = new Map<number, DraftFloorLoad>();
  const convertibleLoads: ConvertibleFrameLoad[] = loads
    .map((load, index) => ({ load, index, totalKN: frameLoadTotalKN(load, patch) }))
    .filter((item): item is ConvertibleFrameLoad => (
      item.totalKN !== undefined
      && Number.isFinite(item.totalKN)
      && item.totalKN > 0
    ));

  const comparableLoads: ConvertibleFrameLoad[] = convertibleLoads.filter((item) => (
    item.load.direction === 'gravity'
    || item.load.direction === 'globalZ'
    || item.load.direction === 'globalX'
    || item.load.direction === 'globalY'
    || item.load.direction === undefined
  ));

  for (const { load, index, totalKN } of comparableLoads) {
    const field = frameFloorLoadField(load);
    let stories: number[];
    const explicitStory = parseStoryOrdinal(load.target, storyCount);
    if (explicitStory !== undefined) {
      stories = [explicitStory];
    } else {
      const sameFieldUntargetedLoads: ConvertibleFrameLoad[] = comparableLoads.filter((item) => (
        frameFloorLoadField(item.load) === field
        && parseStoryOrdinal(item.load.target, storyCount) === undefined
      ));
      const untargetedIndex = sameFieldUntargetedLoads.findIndex((item) => item.index === index);
      if (sameFieldUntargetedLoads.length > 1) {
        stories = untargetedIndex >= 0 && untargetedIndex < storyCount ? [untargetedIndex + 1] : [];
      } else {
        stories = Array.from({ length: storyCount }, (_, storyIndex) => storyIndex + 1);
      }
    }

    for (const story of stories) {
      assignFloorLoadValue(floorLoadsByStory, story, field, Number(totalKN.toFixed(6)));
    }
  }

  return floorLoadsByStory.size
    ? Array.from(floorLoadsByStory.values()).sort((left, right) => left.story - right.story)
    : undefined;
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
  if (primaryLoad && inferredType !== 'frame') {
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
    if (geometry?.bayWidthsXM?.length && geometry?.bayWidthsYM?.length) {
      next.bayWidthsXM = next.bayWidthsXM ?? geometry.bayWidthsXM;
      next.bayCountX = next.bayCountX ?? geometry.bayWidthsXM.length;
      next.frameDimension = next.frameDimension ?? '3d';
    } else if (geometry?.bayWidthsXM?.length && !next.bayWidthsM?.length) {
      next.bayWidthsM = geometry.bayWidthsXM;
      next.bayCount = next.bayCount ?? geometry.bayWidthsXM.length;
      next.frameDimension = next.frameDimension ?? '2d';
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
    next.wind = next.wind ?? engineeringDraft.wind;
    const projectedFloorLoads = mergeFrameFloorLoadValues(
      projectFrameFloorLoads(loads, next),
      projectWindPressureToFloorLoads(next.wind, next),
    );
    if (projectedFloorLoads?.length) {
      next.floorLoads = hasFloorLoadValues(next.floorLoads)
        ? mergeFrameFloorLoadValues(next.floorLoads, projectedFloorLoads)
        : projectedFloorLoads;
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
