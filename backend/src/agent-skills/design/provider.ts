/**
 * Design providers for the Agent design loop.
 *
 * A design provider turns code-check failure signals (member utilization
 * ratios > 1) into concrete model adjustments (section sizing). Providers are
 * pluggable: `proposeLocalRuleDesign` is the built-in rule-based engine and
 * the guaranteed working fallback; external services (e.g. ai-structure.com)
 * implement the same `DesignProvider` interface.
 */
import type { DesignSectionChange } from '../../agent-runtime/types.js';

export interface MemberFailure {
  elementId: string;
  utilization: number;
  clause?: string;
  item?: string;
}

export interface DesignProviderInput {
  model: Record<string, unknown>;
  codeCheck?: Record<string, unknown> | null;
  analysis?: Record<string, unknown> | null;
  /** Safety margin multiplied into failing utilization before sizing. */
  safetyMargin?: number;
}

export interface DesignProviderResult {
  provider: string;
  changes: DesignSectionChange[];
  model: Record<string, unknown>;
  maxUtilizationBefore?: number;
  maxUtilizationAfter?: number;
  notes: string[];
}

export interface DesignProvider {
  id: string;
  propose(input: DesignProviderInput): Promise<DesignProviderResult>;
}

// ---------------------------------------------------------------------------
// Code-check failure extraction
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Max failing utilization per element across all code-check detail items. */
export function extractMemberFailures(codeCheck: unknown): MemberFailure[] {
  const root = asRecord(codeCheck);
  const byElement = new Map<string, MemberFailure>();

  const consider = (elementId: unknown, utilization: unknown, item?: unknown, clause?: unknown) => {
    const id = typeof elementId === 'string' && elementId.trim().length > 0 ? elementId.trim() : undefined;
    const util = toFiniteNumber(utilization);
    if (!id || util === undefined) return;
    const existing = byElement.get(id);
    if (!existing || util > existing.utilization) {
      byElement.set(id, {
        elementId: id,
        utilization: util,
        item: typeof item === 'string' ? item : undefined,
        clause: typeof clause === 'string' ? clause : undefined,
      });
    }
  };

  const details = Array.isArray(root.details) ? root.details : [];
  for (const detail of details) {
    const detailRecord = asRecord(detail);
    const checks = Array.isArray(detailRecord.checks) ? detailRecord.checks : [];
    for (const check of checks) {
      const items = Array.isArray(asRecord(check).items) ? asRecord(check).items as unknown[] : [];
      for (const item of items) {
        const itemRecord = asRecord(item);
        if (String(itemRecord.status ?? '').toLowerCase() !== 'fail') continue;
        consider(detailRecord.elementId, itemRecord.utilization, itemRecord.item, itemRecord.clause);
      }
    }
    if (checks.length === 0 && String(detailRecord.status ?? '').toLowerCase() === 'fail') {
      const controlling = asRecord(detailRecord.controlling);
      consider(detailRecord.elementId, controlling.utilization, controlling.item, controlling.clause);
    }
  }

  // Fallbacks when details are absent (summary or envelope-level signals).
  if (byElement.size === 0) {
    const summary = asRecord(root.summary);
    consider(summary.controllingElement, summary.maxUtilization, summary.controllingCheck);
  }
  if (byElement.size === 0) {
    const data = asRecord(asRecord(root.data).envelope);
    const envelope = asRecord(data.elementUtilization ?? asRecord(root.envelope).elementUtilization);
    for (const [elementId, utilization] of Object.entries(envelope)) {
      const util = toFiniteNumber(utilization);
      if (util !== undefined && util > 1) {
        consider(elementId, util);
      }
    }
  }

  return [...byElement.values()].sort((left, right) => right.utilization - left.utilization);
}

// ---------------------------------------------------------------------------
// Section sizing rules
// ---------------------------------------------------------------------------

const DEFAULT_SAFETY_MARGIN = 1.05;
const DIMENSION_STEP_MM = 10;
const MIN_DIMENSION_INCREMENT_MM = 10;
const MAX_DIMENSION_MM = 2400;
const MAX_LINEAR_SCALE = 2;

/** Linear dimension scale for a failing utilization (geometric similarity). */
export function computeLinearScale(utilization: number, safetyMargin = DEFAULT_SAFETY_MARGIN): number {
  const bounded = Math.min(Math.max(utilization, 1), 4);
  return Math.min(Math.sqrt(bounded * safetyMargin), MAX_LINEAR_SCALE);
}

function nextDimension(currentMm: number, scale: number): number {
  const target = currentMm * scale;
  const stepped = Math.ceil(target / DIMENSION_STEP_MM) * DIMENSION_STEP_MM;
  const next = Math.max(stepped, currentMm + MIN_DIMENSION_INCREMENT_MM);
  return Math.min(next, MAX_DIMENSION_MM);
}

function toM2(mm2: number): number {
  return Number((mm2 * 1e-6).toFixed(8));
}

function toM4(mm4: number): number {
  const value = mm4 * 1e-12;
  return value === 0 ? 0 : Number(value.toExponential(4));
}

interface SectionShapeH { kind: 'H'; H: number; B: number; tw: number; tf: number }
interface SectionShapeRect { kind: 'rectangular'; H: number; B: number }
type SectionShape = SectionShapeH | SectionShapeRect;

function parseShape(section: Record<string, unknown>): SectionShape | undefined {
  const shape = asRecord(section.shape);
  const h = toFiniteNumber(shape.H);
  const b = toFiniteNumber(shape.B);
  if (h === undefined || b === undefined || h <= 0 || b <= 0) return undefined;
  if (shape.kind === 'H') {
    const tw = toFiniteNumber(shape.tw);
    const tf = toFiniteNumber(shape.tf);
    if (tw === undefined || tf === undefined || tw <= 0 || tf <= 0) return undefined;
    return { kind: 'H', H: h, B: b, tw, tf };
  }
  return { kind: 'rectangular', H: h, B: b };
}

function sectionDisplayName(shape: SectionShape, previousName: string): string {
  const prefixMatch = previousName.match(/^(HW|HM|HN|H)/i);
  const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : 'H';
  if (shape.kind === 'H') {
    return `${prefix}${Math.round(shape.H)}X${Math.round(shape.B)}`;
  }
  return `${Math.round(shape.H)}X${Math.round(shape.B)}`;
}

interface UpgradedSection {
  sectionId: string;
  name: string;
  shape: SectionShape;
  properties: { A: number; Iy: number; Iz: number; J: number; G?: number };
}

function upgradeHShape(shape: SectionShapeH, scale: number): SectionShapeH {
  return {
    kind: 'H',
    H: nextDimension(shape.H, scale),
    B: nextDimension(shape.B, scale),
    tw: Math.max(1, Math.round(shape.tw * scale)),
    tf: Math.max(1, Math.round(shape.tf * scale)),
  };
}

function upgradeRectShape(shape: SectionShapeRect, scale: number): SectionShapeRect {
  return { kind: 'rectangular', H: nextDimension(shape.H, scale), B: nextDimension(shape.B, scale) };
}

function sectionProperties(shape: SectionShape, previousG: unknown): UpgradedSection['properties'] {
  if (shape.kind === 'H') {
    const { H, B, tw, tf } = shape;
    const webHeight = H - 2 * tf;
    return {
      A: toM2(2 * B * tf + webHeight * tw),
      Iy: toM4((B * H ** 3 - (B - tw) * webHeight ** 3) / 12),
      Iz: toM4((2 * tf * B ** 3 + webHeight * tw ** 3) / 12),
      J: toM4((2 * B * tf ** 3 + webHeight * tw ** 3) / 3),
      ...(typeof previousG === 'number' ? { G: previousG } : {}),
    };
  }
  const { H, B } = shape;
  return {
    A: toM2(H * B),
    Iy: toM4((B * H ** 3) / 12),
    Iz: toM4((H * B ** 3) / 12),
    J: toM4((H * B ** 3) / 3),
    ...(typeof previousG === 'number' ? { G: previousG } : {}),
  };
}

function dimensionChanged(before: SectionShape, after: SectionShape): boolean {
  return before.H !== after.H || before.B !== after.B
    || (before.kind === 'H' && after.kind === 'H' && (before.tw !== after.tw || before.tf !== after.tf));
}

/**
 * Apply a section shape onto a model section record: recomputes geometric
 * properties and the display name, preserving unknown fields. Used by the
 * local rule engine and by external providers (ai-structure) so every
 * provider produces identically-shaped section records.
 */
export function applySectionShape(
  section: Record<string, unknown>,
  shape: SectionShape,
  name: string,
): Record<string, unknown> {
  const previousProperties = asRecord(section.properties);
  return {
    ...section,
    name,
    shape,
    ...(shape.kind === 'rectangular' ? { width: shape.B / 1000, height: shape.H / 1000 } : {}),
    properties: sectionProperties(shape, previousProperties.G),
  };
}

export function parseSectionShape(section: Record<string, unknown>): SectionShape | undefined {
  return parseShape(section);
}

export function sectionShapeChanged(before: SectionShape, after: SectionShape): boolean {
  return dimensionChanged(before, after);
}

export function displayNameForShape(shape: SectionShape, previousName: string): string {
  return sectionDisplayName(shape, previousName);
}

// ---------------------------------------------------------------------------
// Local rule-based design engine
// ---------------------------------------------------------------------------

/**
 * Rule-based design proposal: upgrade the sections of failing members so the
 * controlling utilization drops below 1.0. Conservative by construction —
 * linear dimensions grow by at most MAX_LINEAR_SCALE per iteration and every
 * change is traceable to specific failing elements.
 */
export async function proposeLocalRuleDesign(input: DesignProviderInput): Promise<DesignProviderResult> {
  const notes: string[] = [];
  const failures = [...extractMemberFailures(input.codeCheck), ...extractMemberFailures(input.analysis)]
    .filter((failure, index, all) => all.findIndex((other) => other.elementId === failure.elementId) === index)
    .sort((left, right) => right.utilization - left.utilization);

  if (failures.length === 0) {
    return { provider: 'local-rule', changes: [], model: input.model, notes: ['No failing members found in code-check results.'] };
  }

  const elements = Array.isArray(input.model.elements) ? input.model.elements as unknown[] : [];
  const sections = Array.isArray(input.model.sections) ? input.model.sections as unknown[] : [];
  const sectionIdByElement = new Map<string, string>();
  for (const element of elements) {
    const record = asRecord(element);
    const id = typeof record.id === 'string' ? record.id : undefined;
    const sectionId = toFiniteNumber(record.section) !== undefined
      ? String(record.section)
      : (typeof record.section === 'string' ? record.section : undefined);
    if (id && sectionId) sectionIdByElement.set(id, sectionId);
  }

  const failuresBySection = new Map<string, MemberFailure[]>();
  const unmapped: string[] = [];
  for (const failure of failures) {
    const sectionId = sectionIdByElement.get(failure.elementId);
    if (!sectionId) {
      unmapped.push(failure.elementId);
      continue;
    }
    failuresBySection.set(sectionId, [...(failuresBySection.get(sectionId) ?? []), failure]);
  }
  if (unmapped.length > 0) {
    notes.push(`Elements without a section reference were skipped: ${unmapped.join(', ')}.`);
  }

  const maxUtilizationBefore = failures[0]?.utilization;
  const changes: DesignSectionChange[] = [];
  let maxUtilizationAfter = 0;

  const nextSections = sections.map((section) => {
    const record = asRecord(section);
    const sectionId = toFiniteNumber(record.id) !== undefined ? String(record.id) : (typeof record.id === 'string' ? record.id : undefined);
    const sectionFailures = sectionId ? failuresBySection.get(sectionId) : undefined;
    const shape = parseShape(record);
    if (!sectionId || !sectionFailures || !shape) {
      return section;
    }

    const controlling = sectionFailures[0];
    const scale = computeLinearScale(controlling.utilization, input.safetyMargin);
    const nextShape = shape.kind === 'H' ? upgradeHShape(shape, scale) : upgradeRectShape(shape, scale);
    // A meaningful upgrade must grow the primary dimensions — at the size cap
    // only tw/tf would change, which is not a reportable section change.
    if (nextShape.H === shape.H && nextShape.B === shape.B) {
      notes.push(`Section ${sectionId} already at the size limit; no further upgrade possible.`);
      return section;
    }

    const previousName = typeof record.name === 'string' ? record.name : sectionId;
    const name = sectionDisplayName(nextShape, previousName);
    const utilizationAfter = Number((controlling.utilization / (scale * scale)).toFixed(4));
    maxUtilizationAfter = Math.max(maxUtilizationAfter, utilizationAfter);
    changes.push({
      sectionId,
      elementIds: sectionFailures.map((failure) => failure.elementId),
      purpose: typeof record.purpose === 'string' ? record.purpose : undefined,
      before: previousName,
      after: name,
      utilizationBefore: Number(controlling.utilization.toFixed(4)),
      utilizationAfter,
      reason: controlling.clause
        ? `Utilization ${controlling.utilization.toFixed(2)} on clause ${controlling.clause} (${controlling.item ?? 'strength'}); scaled dimensions by ${scale.toFixed(2)}.`
        : `Utilization ${controlling.utilization.toFixed(2)} exceeded 1.0; scaled dimensions by ${scale.toFixed(2)}.`,
    });

    return applySectionShape(record, nextShape, name);
  });

  if (changes.length === 0) {
    return {
      provider: 'local-rule',
      changes: [],
      model: input.model,
      maxUtilizationBefore,
      notes: notes.length > 0 ? notes : ['No applicable section upgrade was produced.'],
    };
  }

  const metadata = asRecord(input.model.metadata);
  const nextMetadata: Record<string, unknown> = { ...metadata };
  for (const change of changes) {
    if (change.purpose === 'column') nextMetadata.columnSection = change.after;
    if (change.purpose === 'beam') nextMetadata.beamSection = change.after;
  }

  return {
    provider: 'local-rule',
    changes,
    model: {
      ...input.model,
      sections: nextSections,
      metadata: nextMetadata,
    },
    maxUtilizationBefore,
    maxUtilizationAfter: maxUtilizationAfter > 0 ? maxUtilizationAfter : undefined,
    notes,
  };
}

export const localRuleDesignProvider: DesignProvider = {
  id: 'local-rule',
  propose: proposeLocalRuleDesign,
};
