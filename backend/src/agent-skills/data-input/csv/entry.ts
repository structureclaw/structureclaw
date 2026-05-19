/**
 * CSV/Excel data-input skill entry point.
 *
 * The agent runtime calls `mapCsvToDraftHints` after `analyze_file` has
 * already turned the uploaded spreadsheet into structured headers + rows.
 * This module is intentionally pure: no I/O, no LLM calls, no global
 * state. It only translates the analyze_file payload into a
 * `Partial<DraftState>` patch plus diagnostics for the agent to surface.
 *
 * The agent never feeds the resulting object directly to
 * `extract_draft_params` (whose schema is `{ message, locale? }`). Instead
 * it renders the patch into a natural-language message so the regular
 * draft extraction path remains the single source of truth.
 */
import type { DraftFloorLoad, DraftState } from '../../../agent-runtime/types.js';
import {
  COLUMN_ALIASES,
  matchColumnToField,
  normalizeHeader,
  type KnownDraftField,
} from './column-aliases.js';

export { matchColumnToField, normalizeHeader, COLUMN_ALIASES };
export type { KnownDraftField };

// ---------------------------------------------------------------------------
// analyze_file output shapes (subset we depend on)
// ---------------------------------------------------------------------------

export interface AnalyzeFileCsvOutput {
  type: 'csv';
  headers: string[];
  rows: string[][];
}

export interface AnalyzeFileExcelSheet {
  headers: string[];
  rows: unknown[][];
}

export interface AnalyzeFileExcelOutput {
  type: 'excel';
  sheets: Record<string, AnalyzeFileExcelSheet>;
}

export type AnalyzeFileSpreadsheet = AnalyzeFileCsvOutput | AnalyzeFileExcelOutput;

/** Hints the skill can produce. Mirrors the relevant DraftState slice. */
export type CsvDraftHints = Pick<
  DraftState,
  'storyCount' | 'storyHeightsM' | 'spanLengthM' | 'bayWidthsM' | 'heightM' | 'floorLoads'
>;

export interface MapCsvToDraftHintsResult {
  fields: Partial<CsvDraftHints>;
  unmappedHeaders: string[];
  warnings: string[];
  /** Excel only: which sheet the mapper picked. Undefined for CSV. */
  selectedSheet?: string;
}

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

export interface ParsedCell {
  value: number;
  /** Detected unit, lower-cased; empty string when the cell carried no unit. */
  unit: string;
}

const EMPTY_CELL_TOKENS = new Set(['', 'n/a', 'na', '-', '—', '–', 'null', 'none']);

/**
 * Parse a single spreadsheet cell into `{ value, unit }`.
 *
 * Handles bare numbers, thousands separators (`1,200`), and a trailing unit
 * suffix such as `mm`, `m`, `kn`, `kn/m2`, `kpa`. Returns null for empty
 * sentinels and for strings that contain no numeric prefix.
 */
export function parseNumericCell(raw: unknown): ParsedCell | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw, unit: '' };
  }
  const text = String(raw).trim();
  const lowered = text.toLowerCase();
  if (EMPTY_CELL_TOKENS.has(lowered)) return null;

  const match = lowered.match(
    /^([+-]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z0-9./²³μ-]*)$/,
  );
  if (!match) return null;

  const numeric = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  return { value: numeric, unit: match[2] ?? '' };
}

// ---------------------------------------------------------------------------
// Story heights
// ---------------------------------------------------------------------------

/**
 * Decide whether a numeric story-height reading is in millimetres or metres.
 *
 * Designs above 9 m per story are unusual; below 1 m is impossible. Anything
 * in between is treated as metres unless the cell carried an explicit `mm`
 * unit. Values clearly in the millimetre range (>=1000) are converted.
 */
function storyHeightToMetres(parsed: ParsedCell): { metres: number; warning?: string } {
  const unit = parsed.unit;
  if (unit === 'mm' || unit === 'millimeter' || unit === 'millimetre') {
    return { metres: parsed.value / 1000 };
  }
  if (unit === 'm' || unit === 'meter' || unit === 'metre' || unit === '') {
    if (parsed.value >= 1000 && parsed.value <= 9000) {
      // Bare number in millimetre range — auto-convert.
      return { metres: parsed.value / 1000 };
    }
    if (parsed.value >= 1 && parsed.value <= 9) {
      return { metres: parsed.value };
    }
    return {
      metres: parsed.value,
      warning: `story height ${parsed.value}${unit ? ' ' + unit : ''} is outside the typical 1m–9m / 1000mm–9000mm range`,
    };
  }
  return {
    metres: parsed.value,
    warning: `unrecognised story-height unit "${unit}"; assuming the value is already in metres`,
  };
}

/**
 * Convert a parsed length cell to metres based on its declared unit.
 *
 * Unlike `storyHeightToMetres` this helper does not second-guess bare
 * numbers — span lengths and bay widths can legitimately span anywhere
 * from 1m to 30m+, so a bare 5 means 5 metres, not 5 millimetres. Only
 * an explicit `mm` / `cm` unit triggers conversion.
 */
function convertLengthCellToMetres(parsed: ParsedCell): { metres: number; warning?: string } {
  const unit = parsed.unit;
  if (unit === '' || unit === 'm' || unit === 'meter' || unit === 'metre') {
    return { metres: parsed.value };
  }
  if (unit === 'mm' || unit === 'millimeter' || unit === 'millimetre') {
    return { metres: parsed.value / 1000 };
  }
  if (unit === 'cm' || unit === 'centimeter' || unit === 'centimetre') {
    return { metres: parsed.value / 100 };
  }
  if (unit === 'km' || unit === 'kilometer' || unit === 'kilometre') {
    return { metres: parsed.value * 1000 };
  }
  return {
    metres: parsed.value,
    warning: `unrecognised length unit "${unit}"; assuming the value is already in metres`,
  };
}

/**
 * Convert a parsed force / line-load / area-load cell to kN.
 *
 * DraftFloorLoad fields are typed as kN (per story for vertical, per face
 * for lateral). Spreadsheets sometimes carry plain N, kgf, tf or kPa; this
 * helper normalises the common ones and warns on anything else so the
 * caller can surface the assumption.
 */
function convertForceCellToKN(parsed: ParsedCell): { kN: number; warning?: string } {
  const unit = parsed.unit;
  if (unit === '' || unit === 'kn' || unit === 'kn/m' || unit === 'kn/m²' || unit === 'kn/m2') {
    return { kN: parsed.value };
  }
  if (unit === 'n' || unit === 'n/m' || unit === 'n/m²' || unit === 'n/m2') {
    return { kN: parsed.value / 1000 };
  }
  if (unit === 'kgf' || unit === 'kg' || unit === 'kgf/m' || unit === 'kgf/m²' || unit === 'kgf/m2') {
    // 1 kgf ≈ 0.00981 kN; treat 1 kg ≈ 1 kgf for engineering spreadsheets
    return { kN: parsed.value * 0.00981 };
  }
  if (unit === 'tf' || unit === 't' || unit === 'tf/m' || unit === 'tf/m²' || unit === 'tf/m2') {
    return { kN: parsed.value * 9.81 };
  }
  if (unit === 'kpa') {
    // 1 kPa = 1 kN/m² — line loads in kPa are a unit-system mistake but
    // numerically equivalent for area loads, so pass through with a hint.
    return {
      kN: parsed.value,
      warning: `interpreted kPa as kN/m²; verify the load is an area load rather than a line load`,
    };
  }
  return {
    kN: parsed.value,
    warning: `unrecognised force unit "${unit}"; assuming the value is already in kN (or kN/m / kN/m²)`,
  };
}

/**
 * Extract `storyHeightsM[]` from rows.
 *
 * If `storyHeader` is provided the rows are assumed to be one-per-story and
 * read in row order. Otherwise the first non-empty cell is used as a single
 * value applied to every story (so `[h, h, ..., h]` of length `storyCount`
 * if `storyCount` is also known; otherwise `[h]`).
 */
export function normalizeStoryHeights(
  headers: string[],
  rows: unknown[][],
  options: { heightHeader: string; storyHeader?: string; storyCount?: number },
): { values: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const heightIdx = headers.indexOf(options.heightHeader);
  if (heightIdx < 0) return { values: [], warnings };

  const collected: number[] = [];
  for (const row of rows) {
    const parsed = parseNumericCell(row[heightIdx]);
    if (!parsed) continue;
    const { metres, warning } = storyHeightToMetres(parsed);
    if (warning) warnings.push(warning);
    collected.push(metres);
  }

  if (collected.length === 0) return { values: [], warnings };

  if (options.storyHeader && headers.indexOf(options.storyHeader) >= 0) {
    return { values: collected, warnings };
  }
  // No per-story column: single value, replicated to storyCount if known.
  const single = collected[0];
  const length = options.storyCount && options.storyCount > 0 ? options.storyCount : 1;
  return { values: Array.from({ length }, () => single), warnings };
}

// ---------------------------------------------------------------------------
// Floor loads
// ---------------------------------------------------------------------------

interface FloorLoadColumnMap {
  storyHeader?: string;
  verticalHeader?: string;
  liveLoadHeader?: string;
  lateralXHeader?: string;
  lateralYHeader?: string;
}

/**
 * Build per-story `DraftFloorLoad[]` entries from the spreadsheet rows.
 *
 * One entry is emitted per row that has at least one populated load column.
 * Rows without a recognisable story index are numbered sequentially starting
 * from 1. Missing load columns leave the corresponding field undefined
 * (never zero) so the downstream draft path can distinguish "no data" from
 * "explicit zero load".
 */
export function normalizeFloorLoads(
  headers: string[],
  rows: unknown[][],
  mapping: FloorLoadColumnMap,
): { values: DraftFloorLoad[]; warnings: string[] } {
  const warnings: string[] = [];
  const idx = (header: string | undefined): number =>
    header ? headers.indexOf(header) : -1;

  const storyIdx = idx(mapping.storyHeader);
  const vIdx = idx(mapping.verticalHeader);
  const lIdx = idx(mapping.liveLoadHeader);
  const xIdx = idx(mapping.lateralXHeader);
  const yIdx = idx(mapping.lateralYHeader);

  if (vIdx < 0 && lIdx < 0 && xIdx < 0 && yIdx < 0) {
    return { values: [], warnings };
  }

  const values: DraftFloorLoad[] = [];
  let synthStory = 1;

  for (const row of rows) {
    const v = vIdx >= 0 ? parseNumericCell(row[vIdx]) : null;
    const ll = lIdx >= 0 ? parseNumericCell(row[lIdx]) : null;
    const lx = xIdx >= 0 ? parseNumericCell(row[xIdx]) : null;
    const ly = yIdx >= 0 ? parseNumericCell(row[yIdx]) : null;
    if (!v && !ll && !lx && !ly) continue;

    let story: number;
    if (storyIdx >= 0) {
      const parsedStory = parseNumericCell(row[storyIdx]);
      if (parsedStory && Number.isInteger(parsedStory.value) && parsedStory.value >= 1) {
        story = parsedStory.value;
      } else {
        // Story column is explicitly mapped but this row's story cell is
        // invalid (e.g. a "Total" / "Summary" / blank row). Skip rather
        // than fall back to a synthetic counter, which would collide with
        // a real story number further down.
        continue;
      }
    } else {
      story = synthStory;
      synthStory += 1;
    }

    const entry: DraftFloorLoad = { story };
    if (v) {
      const { kN, warning } = convertForceCellToKN(v);
      entry.verticalKN = kN;
      if (warning) warnings.push(warning);
    }
    if (ll) {
      const { kN, warning } = convertForceCellToKN(ll);
      entry.liveLoadKN = kN;
      if (warning) warnings.push(warning);
    }
    if (lx) {
      const { kN, warning } = convertForceCellToKN(lx);
      entry.lateralXKN = kN;
      if (warning) warnings.push(warning);
    }
    if (ly) {
      const { kN, warning } = convertForceCellToKN(ly);
      entry.lateralYKN = kN;
      if (warning) warnings.push(warning);
    }
    values.push(entry);
  }

  return { values, warnings };
}

// ---------------------------------------------------------------------------
// Header summary helper (also drives Excel sheet selection)
// ---------------------------------------------------------------------------

interface HeaderClassification {
  fieldByHeader: Map<string, KnownDraftField>;
  unmapped: string[];
}

function classifyHeaders(headers: string[]): HeaderClassification {
  const fieldByHeader = new Map<string, KnownDraftField>();
  const unmapped: string[] = [];
  for (const header of headers) {
    if (typeof header !== 'string' || header.length === 0) continue;
    const field = matchColumnToField(header);
    if (field) {
      fieldByHeader.set(header, field);
    } else {
      unmapped.push(header);
    }
  }
  return { fieldByHeader, unmapped };
}

function findHeaderForField(
  classification: HeaderClassification,
  field: KnownDraftField,
): string | undefined {
  for (const [header, mapped] of classification.fieldByHeader) {
    if (mapped === field) return header;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Top-level mapper
// ---------------------------------------------------------------------------

function mapSheet(
  headers: string[],
  rows: unknown[][],
): { fields: Partial<CsvDraftHints>; unmappedHeaders: string[]; warnings: string[] } {
  const classification = classifyHeaders(headers);
  const fields: Partial<CsvDraftHints> = {};
  const warnings: string[] = [];

  // storyCount: scalar from the first row that has a value
  const storyCountHeader = findHeaderForField(classification, 'storyCount');
  if (storyCountHeader) {
    const idx = headers.indexOf(storyCountHeader);
    for (const row of rows) {
      const parsed = parseNumericCell(row[idx]);
      if (parsed && Number.isInteger(parsed.value) && parsed.value > 0) {
        fields.storyCount = parsed.value;
        break;
      }
    }
  }

  // heightM: scalar (overall structural height)
  const heightHeader = findHeaderForField(classification, 'heightM');
  if (heightHeader) {
    const idx = headers.indexOf(heightHeader);
    for (const row of rows) {
      const parsed = parseNumericCell(row[idx]);
      if (parsed && parsed.value > 0) {
        const { metres, warning } = convertLengthCellToMetres(parsed);
        fields.heightM = metres;
        if (warning) warnings.push(warning);
        break;
      }
    }
  }

  // spanLengthM: scalar
  const spanHeader = findHeaderForField(classification, 'spanLengthM');
  if (spanHeader) {
    const idx = headers.indexOf(spanHeader);
    for (const row of rows) {
      const parsed = parseNumericCell(row[idx]);
      if (parsed && parsed.value > 0) {
        const { metres, warning } = convertLengthCellToMetres(parsed);
        fields.spanLengthM = metres;
        if (warning) warnings.push(warning);
        break;
      }
    }
  }

  // bayWidthsM: vector across all rows
  const bayHeader = findHeaderForField(classification, 'bayWidthsM');
  if (bayHeader) {
    const idx = headers.indexOf(bayHeader);
    const collected: number[] = [];
    for (const row of rows) {
      const parsed = parseNumericCell(row[idx]);
      if (parsed && parsed.value > 0) {
        const { metres, warning } = convertLengthCellToMetres(parsed);
        collected.push(metres);
        if (warning) warnings.push(warning);
      }
    }
    if (collected.length > 0) fields.bayWidthsM = collected;
  }

  // storyHeightsM: vector (or scalar replicated to storyCount)
  const storyHeightHeader = findHeaderForField(classification, 'storyHeightsM');
  const storyIndexHeader = findHeaderForField(classification, 'storyIndex');
  if (storyHeightHeader) {
    const heights = normalizeStoryHeights(headers, rows, {
      heightHeader: storyHeightHeader,
      storyHeader: storyIndexHeader,
      storyCount: fields.storyCount,
    });
    if (heights.values.length > 0) fields.storyHeightsM = heights.values;
    warnings.push(...heights.warnings);
  }

  // floorLoads
  const loads = normalizeFloorLoads(headers, rows, {
    storyHeader: storyIndexHeader,
    verticalHeader: findHeaderForField(classification, 'verticalKN'),
    liveLoadHeader: findHeaderForField(classification, 'liveLoadKN'),
    lateralXHeader: findHeaderForField(classification, 'lateralXKN'),
    lateralYHeader: findHeaderForField(classification, 'lateralYKN'),
  });
  if (loads.values.length > 0) fields.floorLoads = loads.values;
  warnings.push(...loads.warnings);

  return { fields, unmappedHeaders: classification.unmapped, warnings };
}

/**
 * Translate an `analyze_file` spreadsheet payload into a Partial DraftState
 * patch plus diagnostics. For Excel inputs the sheet whose header row
 * matches the most known fields is selected; ties resolve by sheet order.
 */
export function mapCsvToDraftHints(
  payload: AnalyzeFileSpreadsheet,
): MapCsvToDraftHintsResult {
  if (payload.type === 'csv') {
    const { fields, unmappedHeaders, warnings } = mapSheet(payload.headers, payload.rows);
    return { fields, unmappedHeaders, warnings };
  }

  const sheetNames = Object.keys(payload.sheets);
  if (sheetNames.length === 0) {
    return { fields: {}, unmappedHeaders: [], warnings: ['workbook contains no sheets'] };
  }

  let bestSheet = sheetNames[0];
  let bestScore = -1;
  for (const name of sheetNames) {
    const sheet = payload.sheets[name];
    const score = classifyHeaders(sheet.headers).fieldByHeader.size;
    if (score > bestScore) {
      bestScore = score;
      bestSheet = name;
    }
  }

  const chosen = payload.sheets[bestSheet];
  const result = mapSheet(chosen.headers, chosen.rows);
  const warnings = [...result.warnings];
  if (sheetNames.length > 1) {
    warnings.push(
      `workbook has ${sheetNames.length} sheets (${sheetNames.join(', ')}); selected "${bestSheet}" based on header match`,
    );
  }
  return {
    fields: result.fields,
    unmappedHeaders: result.unmappedHeaders,
    warnings,
    selectedSheet: bestSheet,
  };
}
