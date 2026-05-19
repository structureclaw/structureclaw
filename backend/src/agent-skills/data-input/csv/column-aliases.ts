/**
 * Column alias table for the CSV/Excel data-input skill.
 *
 * Maps human-written spreadsheet header text (Chinese / English / mixed) to
 * the small set of DraftState fields the skill knows how to populate.
 *
 * Header matching is intentionally deterministic: lower-cased, whitespace
 * collapsed, and parenthetical fragments stripped before lookup. Unmatched
 * headers are returned to the caller verbatim so the agent can decide
 * whether to ask the user for clarification.
 */

/**
 * The DraftState fields this skill knows how to fill from a spreadsheet.
 *
 * Keep this list narrow — anything not listed here lands in
 * `unmappedHeaders` and is surfaced to the user.
 */
export type KnownDraftField =
  | 'storyIndex'      // synthetic: not a DraftState field, used to group rows by story
  | 'storyCount'
  | 'storyHeightsM'
  | 'spanLengthM'
  | 'bayWidthsM'
  | 'heightM'
  | 'verticalKN'
  | 'liveLoadKN'
  | 'lateralXKN'
  | 'lateralYKN';

/**
 * Curated alias list per known field.
 *
 * Aliases are matched after `normalizeHeader` is applied to both the
 * spreadsheet header and the alias itself, so trailing units in
 * parentheses (e.g. "层高(m)", "Story Height (mm)") match the bare alias.
 */
export const COLUMN_ALIASES: Readonly<Record<KnownDraftField, readonly string[]>> = {
  storyIndex: [
    '楼层', '层号', '层数索引',
    'story', 'storey', 'level', 'floor', 'floor index', 'story index',
  ],
  storyCount: [
    '总层数', '楼层数', '层数', '层总数',
    'story count', 'storey count', 'number of stories', 'total stories',
  ],
  storyHeightsM: [
    '层高', '楼层高度', '楼层层高',
    'story height', 'storey height', 'floor height', 'height per story',
  ],
  spanLengthM: [
    '跨度', '跨长', '单跨跨度',
    'span', 'span length', 'bay span',
  ],
  bayWidthsM: [
    '柱距', '柱网间距', '开间', '开间宽度', '跨宽',
    'bay width', 'bay widths', 'column spacing', 'grid spacing',
  ],
  heightM: [
    '总高', '总高度', '建筑高度', '结构总高',
    'height', 'total height', 'overall height', 'building height',
  ],
  verticalKN: [
    '恒载', '恒荷载', '永久荷载', '自重',
    'dead load', 'dl', 'permanent load', 'self weight', 'vertical load',
  ],
  liveLoadKN: [
    '活载', '活荷载', '使用荷载', '可变荷载',
    'live load', 'll', 'imposed load', 'variable load',
  ],
  lateralXKN: [
    '风载x', '风荷载x', '水平荷载x', 'x向风载', 'x向水平荷载',
    'wind x', 'wind-x', 'lateral x', 'lateral load x',
  ],
  lateralYKN: [
    '风载y', '风荷载y', '水平荷载y', 'y向风载', 'y向水平荷载',
    'wind y', 'wind-y', 'lateral y', 'lateral load y',
  ],
} as const;

/**
 * Normalise a spreadsheet header so it matches the alias table.
 *
 * The transformation is:
 *   1. Lower-case ASCII letters (Chinese characters are unaffected).
 *   2. Strip every "(...)" / "（...）" fragment so trailing units fall away.
 *   3. Collapse all ASCII and CJK whitespace to nothing.
 *   4. Trim residual punctuation that commonly appears after column splitting.
 */
export function normalizeHeader(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，,。.;；:：]+$/g, '');
}

// Pre-build a flat lookup map: normalisedAlias -> field
const ALIAS_LOOKUP: Readonly<Record<string, KnownDraftField>> = (() => {
  const map: Record<string, KnownDraftField> = {};
  for (const field of Object.keys(COLUMN_ALIASES) as KnownDraftField[]) {
    for (const alias of COLUMN_ALIASES[field]) {
      const key = normalizeHeader(alias);
      if (key && !(key in map)) {
        map[key] = field;
      }
    }
  }
  return map;
})();

/**
 * Match a raw spreadsheet header to a known DraftState field, or return
 * `null` if the header does not correspond to any known field.
 */
export function matchColumnToField(rawHeader: string): KnownDraftField | null {
  const key = normalizeHeader(rawHeader);
  if (!key) return null;
  return ALIAS_LOOKUP[key] ?? null;
}
