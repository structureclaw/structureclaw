import type { AppLocale } from '../../services/locale.js';
import type {
  DraftExtraction,
  DraftState,
  InteractionQuestion,
  LocalizedText,
  SkillDefaultProposal,
} from '../../agent-runtime/types.js';

export interface SectionPoint {
  x: number;
  y: number;
}

export interface SectionProfile {
  id: string;
  aliases: string[];
  label: LocalizedText;
  description: LocalizedText;
  defaultGeometry: Record<string, number>;
  requiredKeys: string[];
  optionalKeys: string[];
  dimensionAliases: Record<string, string[]>;
  defaultMemberRole: 'beam' | 'column' | 'girder' | 'custom';
}

export interface SectionPropertySummary {
  areaMM2?: number;
  ixMM4?: number;
  iyMM4?: number;
  centroidXMM?: number;
  centroidYMM?: number;
  warnings: string[];
}

export interface SectionModelOptions {
  skillId: string;
  family: string;
  title: LocalizedText;
  sectionType: string;
  memberRole: string;
  materialGrade: string;
  materialName: LocalizedText;
  materialFamily?: string;
  materialDensityKgM3?: number;
  geometry: Record<string, unknown>;
  spanLengthM?: number;
  outlinePoints?: SectionPoint[];
  warnings?: string[];
  notes?: string[];
  extras?: Record<string, unknown>;
}

export function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

export function normalizeSectionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[×*]/g, 'x')
    .replace(/[，。；；、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsAny(text: string, keywords: string[]): boolean {
  const normalizedText = normalizeSectionText(text);
  return keywords.some((keyword) => normalizedText.includes(normalizeSectionText(keyword)));
}

export function extractNumberAfterAlias(text: string, aliases: string[]): number | undefined {
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}\\s*(?:=|:|：|x)?\\s*(\\d+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`${escaped}\\s*[×x\\*]\\s*(\\d+(?:\\.\\d+)?)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return undefined;
}

export function extractNamedNumbers(text: string, aliasesByKey: Record<string, string[]>): Record<string, number | undefined> {
  const normalized = normalizeSectionText(text);
  const result: Record<string, number | undefined> = {};

  for (const [key, aliases] of Object.entries(aliasesByKey)) {
    result[key] = extractNumberAfterAlias(normalized, aliases.map((alias) => normalizeSectionText(alias)));
  }

  return result;
}

export function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

export function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function parseString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

export function parsePointList(value: unknown): SectionPoint[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const points: SectionPoint[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && entry.length >= 2) {
      const x = parseFiniteNumber(entry[0]);
      const y = parseFiniteNumber(entry[1]);
      if (x !== undefined && y !== undefined) {
        points.push({ x, y });
      }
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const x = parseFiniteNumber(record.x ?? record.X ?? record[0]);
      const y = parseFiniteNumber(record.y ?? record.Y ?? record[1]);
      if (x !== undefined && y !== undefined) {
        points.push({ x, y });
      }
    }
  }

  return points.length > 0 ? points : undefined;
}

export function pickSectionProfile(text: string, profiles: SectionProfile[]): SectionProfile | undefined {
  const normalized = normalizeSectionText(text);
  const orderedProfiles = [...profiles].sort((left, right) => {
    const leftWeight = Math.max(...left.aliases.map((alias) => alias.length));
    const rightWeight = Math.max(...right.aliases.map((alias) => alias.length));
    return rightWeight - leftWeight;
  });

  for (const profile of orderedProfiles) {
    if (profile.aliases.some((alias) => normalized.includes(normalizeSectionText(alias)))) {
      return profile;
    }
  }

  return undefined;
}

function computeRectangleProperties(h: number, b: number): SectionPropertySummary {
  const areaMM2 = h * b;
  const ixMM4 = (b * Math.pow(h, 3)) / 12;
  const iyMM4 = (h * Math.pow(b, 3)) / 12;
  return { areaMM2, ixMM4, iyMM4, warnings: [] };
}

function computeBoxProperties(h: number, b: number, t: number): SectionPropertySummary {
  const innerH = Math.max(h - 2 * t, 0);
  const innerB = Math.max(b - 2 * t, 0);
  const areaMM2 = Math.max(h * b - innerH * innerB, 0);
  const ixMM4 = Math.max((b * Math.pow(h, 3)) - (innerB * Math.pow(innerH, 3)), 0) / 12;
  const iyMM4 = Math.max((h * Math.pow(b, 3)) - (innerH * Math.pow(innerB, 3)), 0) / 12;
  return { areaMM2, ixMM4, iyMM4, warnings: [] };
}

function computeISectionProperties(h: number, b: number, tw: number, tf: number): SectionPropertySummary {
  const webHeight = Math.max(h - 2 * tf, 0);
  const areaMM2 = 2 * b * tf + webHeight * tw;
  const flangeOffset = Math.max(h / 2 - tf / 2, 0);
  const ixMM4 = 2 * ((b * Math.pow(tf, 3)) / 12 + b * tf * Math.pow(flangeOffset, 2)) + (tw * Math.pow(webHeight, 3)) / 12;
  const iyMM4 = 2 * ((tf * Math.pow(b, 3)) / 12) + (webHeight * Math.pow(tw, 3)) / 12;
  return { areaMM2, ixMM4, iyMM4, warnings: [] };
}

function computeChannelProperties(h: number, b: number, tw: number, tf: number): SectionPropertySummary {
  const webHeight = Math.max(h - 2 * tf, 0);
  const areaMM2 = 2 * b * tf + webHeight * tw;
  const ixMM4 = 2 * ((b * Math.pow(tf, 3)) / 12 + b * tf * Math.pow(Math.max(h / 2 - tf / 2, 0), 2)) + (tw * Math.pow(webHeight, 3)) / 12;
  const iyMM4 = 2 * ((tf * Math.pow(b, 3)) / 12) + (webHeight * Math.pow(tw, 3)) / 12;
  return {
    areaMM2,
    ixMM4,
    iyMM4,
    warnings: ['Channel properties are approximate and ignore section asymmetry.'],
  };
}

function computeTSectionProperties(h: number, b: number, tw: number, tf: number): SectionPropertySummary {
  const stemHeight = Math.max(h - tf, 0);
  const areaMM2 = b * tf + stemHeight * tw;
  const xBar = (b * tf * (tf / 2) + stemHeight * tw * (tf + stemHeight / 2)) / Math.max(areaMM2, 1);
  const flangeOffset = Math.abs(xBar - tf / 2);
  const stemOffset = Math.abs(tf + stemHeight / 2 - xBar);
  const ixMM4 = (b * Math.pow(tf, 3)) / 12 + b * tf * Math.pow(flangeOffset, 2) + (tw * Math.pow(stemHeight, 3)) / 12 + stemHeight * tw * Math.pow(stemOffset, 2);
  const iyMM4 = (tf * Math.pow(b, 3)) / 12 + (stemHeight * Math.pow(tw, 3)) / 12;
  return { areaMM2, ixMM4, iyMM4, centroidYMM: xBar, warnings: ['T-section properties are approximate.'] };
}

function computePolygonProperties(points: SectionPoint[]): SectionPropertySummary {
  if (points.length < 3) {
    return { warnings: ['At least three outline points are required to compute polygon properties.'] };
  }

  let twiceArea = 0;
  let ixOrigin = 0;
  let iyOrigin = 0;
  let cxFactor = 0;
  let cyFactor = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    ixOrigin += (current.y ** 2 + current.y * next.y + next.y ** 2) * cross;
    iyOrigin += (current.x ** 2 + current.x * next.x + next.x ** 2) * cross;
    cxFactor += (current.x + next.x) * cross;
    cyFactor += (current.y + next.y) * cross;
  }

  const areaMM2 = twiceArea / 2;
  if (Math.abs(areaMM2) < 1e-6) {
    return { warnings: ['Polygon outline is degenerate and does not enclose area.'] };
  }

  const centroidXMM = cxFactor / (3 * twiceArea);
  const centroidYMM = cyFactor / (3 * twiceArea);
  const ixMM4 = ixOrigin / 12 - areaMM2 * Math.pow(centroidYMM, 2);
  const iyMM4 = iyOrigin / 12 - areaMM2 * Math.pow(centroidXMM, 2);

  return {
    areaMM2: Math.abs(areaMM2),
    ixMM4: Math.abs(ixMM4),
    iyMM4: Math.abs(iyMM4),
    centroidXMM,
    centroidYMM,
    warnings: [],
  };
}

export function calculateProfileProperties(
  shapeId: string,
  geometry: Record<string, unknown>,
  outlinePoints?: SectionPoint[],
): SectionPropertySummary {
  if (outlinePoints?.length) {
    const polygonSummary = computePolygonProperties(outlinePoints);
    if (!polygonSummary.warnings.length || polygonSummary.areaMM2 !== undefined) {
      return polygonSummary;
    }
  }

  const h = parsePositiveNumber(geometry.h);
  const b = parsePositiveNumber(geometry.b);
  const tw = parsePositiveNumber(geometry.tw ?? geometry.t);
  const tf = parsePositiveNumber(geometry.tf ?? geometry.t);
  const d = parsePositiveNumber(geometry.d);

  if (shapeId === 'rectangle' && h !== undefined && b !== undefined) {
    return computeRectangleProperties(h, b);
  }

  if ((shapeId === 'box' || shapeId === 'box-girder' || shapeId === 'composite-box' || shapeId === 'tapered-box') && h !== undefined && b !== undefined && tw !== undefined) {
    return computeBoxProperties(h, b, tw);
  }

  if ((shapeId === 'i-beam' || shapeId === 'h-beam' || shapeId === 'i-girder' || shapeId === 'plate-girder' || shapeId === 'composite-girder' || shapeId === 'asymmetric-built-up' || shapeId === 'tapered-i') && h !== undefined && b !== undefined && tw !== undefined && tf !== undefined) {
    return computeISectionProperties(h, b, tw, tf);
  }

  if (shapeId === 'channel' && h !== undefined && b !== undefined && tw !== undefined && tf !== undefined) {
    return computeChannelProperties(h, b, tw, tf);
  }

  if (shapeId === 't-girder' && h !== undefined && b !== undefined && tw !== undefined && tf !== undefined) {
    return computeTSectionProperties(h, b, tw, tf);
  }

  if (shapeId === 'pipe' && d !== undefined && tw !== undefined) {
    const innerD = Math.max(d - 2 * tw, 0);
    const areaMM2 = (Math.PI / 4) * (d ** 2 - innerD ** 2);
    const ixMM4 = (Math.PI / 64) * (d ** 4 - innerD ** 4);
    return { areaMM2, ixMM4, iyMM4: ixMM4, warnings: [] };
  }

  return { warnings: ['Section properties could not be computed from the provided geometry.'] };
}

export function buildQuestion(
  locale: AppLocale,
  paramKey: string,
  label: LocalizedText,
  question: LocalizedText,
  required: boolean,
  critical: boolean,
  suggestedValue?: unknown,
  unit?: string,
): InteractionQuestion {
  return {
    paramKey,
    label: localize(locale, label.zh, label.en),
    question: localize(locale, question.zh, question.en),
    required,
    critical,
    suggestedValue,
    unit,
  };
}

export function buildProposal(
  locale: AppLocale,
  paramKey: string,
  value: unknown,
  reason: LocalizedText,
): SkillDefaultProposal {
  return {
    paramKey,
    value,
    reason: localize(locale, reason.zh, reason.en),
  };
}

export function mergeSectionState(existing: DraftState | undefined, patch: DraftExtraction, fallback: Partial<DraftState>): DraftState {
  return {
    ...fallback,
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    inferredType: patch.inferredType ?? existing?.inferredType ?? fallback.inferredType ?? 'unknown',
    structuralTypeKey: patch.structuralTypeKey ?? existing?.structuralTypeKey ?? fallback.structuralTypeKey ?? 'unknown',
  };
}

export function buildSectionModel(options: SectionModelOptions): Record<string, unknown> {
  const now = Date.now();
  const spanLengthM = options.spanLengthM ?? 6;
  const properties = calculateProfileProperties(options.sectionType, options.geometry, options.outlinePoints);
  const warnings = [...(options.warnings ?? []), ...properties.warnings];
  const areaM2 = Math.max((properties.areaMM2 ?? 10000) * 1e-6, 1e-4);
  const iyM4 = Math.max((properties.iyMM4 ?? 1e8) * 1e-12, 1e-8);
  const izM4 = Math.max((properties.ixMM4 ?? 1e8) * 1e-12, 1e-8);
  const shearModulus = 79000;

  const baseRestraints = options.memberRole === 'column'
    ? [true, true, true, true, true, true]
    : [true, true, true, false, false, false];

  return {
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes: [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: baseRestraints },
      { id: 'N2', x: spanLengthM, y: 0, z: 0 },
    ],
    elements: [
      {
        id: 'E1',
        type: 'beam',
        nodes: ['N1', 'N2'],
        material: 'M1',
        section: 'S1',
      },
    ],
    materials: [{
      id: 'M1',
      name: options.materialGrade,
      E: 205000,
      nu: 0.3,
      rho: options.materialDensityKgM3 ?? 7850,
      fy: 345,
    }],
    sections: [
      {
        id: 'S1',
        name: options.sectionType,
        type: 'beam',
        properties: {
          A: areaM2,
          Iy: iyM4,
          Iz: izM4,
          J: Math.max(Math.min(iyM4, izM4), 1e-8),
          G: shearModulus,
        },
      },
    ],
    load_cases: [{ id: 'LC1', type: 'other', loads: [] }],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      id: `section-model-${options.skillId}-${now}`,
      domain: 'section',
      skillId: options.skillId,
      family: options.family,
      title: options.title,
      sectionType: options.sectionType,
      memberRole: options.memberRole,
      material: {
        id: `mat-${options.materialGrade.toLowerCase()}`,
        grade: options.materialGrade,
        name: options.materialName,
        family: options.materialFamily ?? 'steel',
        densityKgM3: options.materialDensityKgM3 ?? 7850,
      },
      geometry: {
        ...options.geometry,
        spanLengthM,
      },
      outlinePoints: options.outlinePoints,
      sectionProperties: properties,
      warnings,
      notes: options.notes,
      createdAt: new Date(now).toISOString(),
      sourceSkillId: options.skillId,
      ...options.extras,
    },
  };
}
