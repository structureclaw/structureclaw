import { describe, expect, test } from '@jest/globals';
import {
  matchColumnToField,
  normalizeHeader,
  parseNumericCell,
  normalizeStoryHeights,
  normalizeFloorLoads,
  mapCsvToDraftHints,
} from '../../../../../dist/agent-skills/data-input/csv/entry.js';

// ---------------------------------------------------------------------------
// Header normalisation + alias matching
// ---------------------------------------------------------------------------

describe('normalizeHeader', () => {
  test('lower-cases ASCII letters and keeps Chinese characters', () => {
    expect(normalizeHeader('Story Height')).toBe('storyheight');
    expect(normalizeHeader('层高')).toBe('层高');
  });

  test('strips parenthetical fragments and unit suffixes inside parens', () => {
    expect(normalizeHeader('层高(m)')).toBe('层高');
    expect(normalizeHeader('Story Height (mm)')).toBe('storyheight');
    expect(normalizeHeader('恒载（kN/m²）')).toBe('恒载');
  });

  test('collapses ASCII and full-width whitespace', () => {
    expect(normalizeHeader('  Dead   Load ')).toBe('deadload');
    expect(normalizeHeader('层 高')).toBe('层高');
    expect(normalizeHeader('层　高')).toBe('层高');
  });

  test('returns empty string for non-string or empty input', () => {
    expect(normalizeHeader('')).toBe('');
  });
});

describe('matchColumnToField', () => {
  test('matches Chinese aliases (层高 / 恒载 / 楼层)', () => {
    expect(matchColumnToField('层高')).toBe('storyHeightsM');
    expect(matchColumnToField('层高(m)')).toBe('storyHeightsM');
    expect(matchColumnToField('恒荷载')).toBe('verticalKN');
    expect(matchColumnToField('楼层')).toBe('storyIndex');
  });

  test('matches English aliases case-insensitively', () => {
    expect(matchColumnToField('Story Height')).toBe('storyHeightsM');
    expect(matchColumnToField('DL')).toBe('verticalKN');
    expect(matchColumnToField('Dead Load')).toBe('verticalKN');
    expect(matchColumnToField('Live Load')).toBe('liveLoadKN');
  });

  test('returns null for unknown headers', () => {
    expect(matchColumnToField('混凝土等级')).toBeNull();
    expect(matchColumnToField('foobar')).toBeNull();
    expect(matchColumnToField('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseNumericCell
// ---------------------------------------------------------------------------

describe('parseNumericCell', () => {
  test('parses bare numbers as numeric or string', () => {
    expect(parseNumericCell(3500)).toEqual({ value: 3500, unit: '' });
    expect(parseNumericCell('3500')).toEqual({ value: 3500, unit: '' });
    expect(parseNumericCell('3.5')).toEqual({ value: 3.5, unit: '' });
  });

  test('parses values with trailing units', () => {
    expect(parseNumericCell('3500mm')).toEqual({ value: 3500, unit: 'mm' });
    expect(parseNumericCell('3.5 m')).toEqual({ value: 3.5, unit: 'm' });
    expect(parseNumericCell('5 kN')).toEqual({ value: 5, unit: 'kn' });
  });

  test('parses superscript and compound units common in structural engineering', () => {
    expect(parseNumericCell('5 kN/m²')).toEqual({ value: 5, unit: 'kn/m²' });
    expect(parseNumericCell('2.5kN/m³')).toEqual({ value: 2.5, unit: 'kn/m³' });
    expect(parseNumericCell('120 kN.m')).toEqual({ value: 120, unit: 'kn.m' });
    expect(parseNumericCell('1.5e3 mm')).toEqual({ value: 1500, unit: 'mm' });
  });

  test('handles thousands separators', () => {
    expect(parseNumericCell('1,200')).toEqual({ value: 1200, unit: '' });
    expect(parseNumericCell('12,000mm')).toEqual({ value: 12000, unit: 'mm' });
  });

  test('returns null for empty-cell sentinels', () => {
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('N/A')).toBeNull();
    expect(parseNumericCell('n/a')).toBeNull();
    expect(parseNumericCell('—')).toBeNull();
    expect(parseNumericCell('-')).toBeNull();
    expect(parseNumericCell(null)).toBeNull();
    expect(parseNumericCell(undefined)).toBeNull();
  });

  test('returns null for strings with no leading number', () => {
    expect(parseNumericCell('abc')).toBeNull();
    expect(parseNumericCell('C30')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeStoryHeights
// ---------------------------------------------------------------------------

describe('normalizeStoryHeights', () => {
  test('replicates a single bare-metres height across storyCount', () => {
    const result = normalizeStoryHeights(
      ['层高'],
      [['3.5']],
      { heightHeader: '层高', storyCount: 5 },
    );
    expect(result.values).toEqual([3.5, 3.5, 3.5, 3.5, 3.5]);
  });

  test('auto-converts millimetre values to metres', () => {
    const result = normalizeStoryHeights(
      ['层高'],
      [['3500']],
      { heightHeader: '层高', storyCount: 3 },
    );
    expect(result.values).toEqual([3.5, 3.5, 3.5]);
  });

  test('keeps per-story heights when storyHeader is present', () => {
    const result = normalizeStoryHeights(
      ['楼层', '层高'],
      [
        ['1', '4.5'],
        ['2', '3.5'],
        ['3', '3.5'],
      ],
      { heightHeader: '层高', storyHeader: '楼层' },
    );
    expect(result.values).toEqual([4.5, 3.5, 3.5]);
  });

  test('warns on out-of-range bare-number heights', () => {
    const result = normalizeStoryHeights(
      ['层高'],
      [['50']], // ambiguous: not mm, not plausible m
      { heightHeader: '层高', storyCount: 1 },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeFloorLoads
// ---------------------------------------------------------------------------

describe('normalizeFloorLoads', () => {
  test('emits one FloorLoad per row with at least one populated load', () => {
    const result = normalizeFloorLoads(
      ['楼层', '恒载', '活载'],
      [
        ['1', '5', '2'],
        ['2', '5', '2'],
        ['3', '4', '1.5'],
      ],
      { storyHeader: '楼层', verticalHeader: '恒载', liveLoadHeader: '活载' },
    );
    expect(result.values).toEqual([
      { story: 1, verticalKN: 5, liveLoadKN: 2 },
      { story: 2, verticalKN: 5, liveLoadKN: 2 },
      { story: 3, verticalKN: 4, liveLoadKN: 1.5 },
    ]);
  });

  test('leaves missing load columns as undefined (not zero)', () => {
    const result = normalizeFloorLoads(
      ['楼层', '恒载'],
      [
        ['1', '5'],
        ['2', '5'],
      ],
      { storyHeader: '楼层', verticalHeader: '恒载' },
    );
    expect(result.values).toEqual([
      { story: 1, verticalKN: 5 },
      { story: 2, verticalKN: 5 },
    ]);
    for (const entry of result.values) {
      expect(entry.liveLoadKN).toBeUndefined();
      expect(entry.lateralXKN).toBeUndefined();
      expect(entry.lateralYKN).toBeUndefined();
    }
  });

  test('synthesises story numbers when no storyIndex column exists', () => {
    const result = normalizeFloorLoads(
      ['恒载', '活载'],
      [
        ['5', '2'],
        ['4', '1.5'],
      ],
      { verticalHeader: '恒载', liveLoadHeader: '活载' },
    );
    expect(result.values).toEqual([
      { story: 1, verticalKN: 5, liveLoadKN: 2 },
      { story: 2, verticalKN: 4, liveLoadKN: 1.5 },
    ]);
  });

  test('skips rows with invalid story cells when storyHeader is mapped', () => {
    // Spreadsheets often contain a "Total" or summary row whose story cell
    // is non-numeric. With a synthetic fallback such a row would collide
    // with a real story 1; skipping keeps the load list correctly indexed.
    const result = normalizeFloorLoads(
      ['楼层', '恒载', '活载'],
      [
        ['Total', '15', '6'],   // invalid story → skip entirely
        ['1', '5', '2'],
        ['2', '5', '2'],
        ['3', '5', '2'],
      ],
      { storyHeader: '楼层', verticalHeader: '恒载', liveLoadHeader: '活载' },
    );
    expect(result.values).toEqual([
      { story: 1, verticalKN: 5, liveLoadKN: 2 },
      { story: 2, verticalKN: 5, liveLoadKN: 2 },
      { story: 3, verticalKN: 5, liveLoadKN: 2 },
    ]);
  });

  test('returns empty when no load columns are mapped', () => {
    const result = normalizeFloorLoads(['楼层'], [['1']], { storyHeader: '楼层' });
    expect(result.values).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mapCsvToDraftHints
// ---------------------------------------------------------------------------

describe('mapCsvToDraftHints — CSV input', () => {
  test('produces a full DraftState patch from a complete spreadsheet', () => {
    const result = mapCsvToDraftHints({
      type: 'csv',
      headers: ['楼层', '层高', '恒载', '活载'],
      rows: [
        ['1', '3.5', '5', '2'],
        ['2', '3.5', '5', '2'],
        ['3', '3.5', '4', '1.5'],
      ],
    });

    expect(result.unmappedHeaders).toEqual([]);
    expect(result.fields.storyHeightsM).toEqual([3.5, 3.5, 3.5]);
    expect(result.fields.floorLoads).toEqual([
      { story: 1, verticalKN: 5, liveLoadKN: 2 },
      { story: 2, verticalKN: 5, liveLoadKN: 2 },
      { story: 3, verticalKN: 4, liveLoadKN: 1.5 },
    ]);
  });

  test('reports unknown columns in unmappedHeaders', () => {
    const result = mapCsvToDraftHints({
      type: 'csv',
      headers: ['楼层', '层高', '混凝土等级', '钢筋牌号'],
      rows: [['1', '3.5', 'C30', 'HRB400']],
    });
    expect(result.unmappedHeaders).toEqual(['混凝土等级', '钢筋牌号']);
    expect(result.fields.storyHeightsM).toEqual([3.5]);
  });

  test('returns empty fields and lists all headers when nothing matches', () => {
    const result = mapCsvToDraftHints({
      type: 'csv',
      headers: ['项目', '设计单位'],
      rows: [['办公楼', '某院']],
    });
    expect(result.fields).toEqual({});
    expect(result.unmappedHeaders).toEqual(['项目', '设计单位']);
  });

  test('extracts storyCount and heightM as scalars from the first valid row', () => {
    const result = mapCsvToDraftHints({
      type: 'csv',
      headers: ['总层数', '总高'],
      rows: [['5', '17.5']],
    });
    expect(result.fields.storyCount).toBe(5);
    expect(result.fields.heightM).toBe(17.5);
  });

  test('honours mm/cm/km units on length scalars', () => {
    const mm = mapCsvToDraftHints({
      type: 'csv',
      headers: ['总高', '跨度'],
      rows: [['17500mm', '6000 mm']],
    });
    expect(mm.fields.heightM).toBe(17.5);
    expect(mm.fields.spanLengthM).toBe(6);

    const cm = mapCsvToDraftHints({
      type: 'csv',
      headers: ['总高'],
      rows: [['1750 cm']],
    });
    expect(cm.fields.heightM).toBe(17.5);
  });

  test('honours mm units inside bayWidthsM vector', () => {
    const result = mapCsvToDraftHints({
      type: 'csv',
      headers: ['开间'],
      rows: [['6000mm'], ['7500mm'], ['6000 mm']],
    });
    expect(result.fields.bayWidthsM).toEqual([6, 7.5, 6]);
  });

  test('converts force units to kN inside floorLoads', () => {
    const result = mapCsvToDraftHints({
      type: 'csv',
      headers: ['楼层', '恒载', '活载'],
      rows: [
        ['1', '5000 N/m²', '2000N/m²'],
        ['2', '0.5 tf/m²', '0.2 tf/m²'],
      ],
    });
    expect(result.fields.floorLoads).toEqual([
      { story: 1, verticalKN: 5, liveLoadKN: 2 },
      { story: 2, verticalKN: 0.5 * 9.81, liveLoadKN: 0.2 * 9.81 },
    ]);
  });
});

describe('mapCsvToDraftHints — Excel multi-sheet', () => {
  test('selects the sheet whose headers match the most known fields', () => {
    const result = mapCsvToDraftHints({
      type: 'excel',
      sheets: {
        '封面': {
          headers: ['项目名称', '设计人'],
          rows: [['某办公楼', '张工']],
        },
        '参数': {
          headers: ['楼层', '层高', '恒载', '活载'],
          rows: [
            ['1', '3.5', '5', '2'],
            ['2', '3.5', '5', '2'],
          ],
        },
      },
    });
    expect(result.selectedSheet).toBe('参数');
    expect(result.fields.storyHeightsM).toEqual([3.5, 3.5]);
    expect(result.warnings.some((w) => w.includes('selected'))).toBe(true);
  });

  test('falls back to the first sheet when no sheet has any known column', () => {
    const result = mapCsvToDraftHints({
      type: 'excel',
      sheets: {
        '封面': { headers: ['项目名称'], rows: [['某办公楼']] },
        '说明': { headers: ['备注'], rows: [['XXX']] },
      },
    });
    expect(result.selectedSheet).toBe('封面');
    expect(result.fields).toEqual({});
  });

  test('reports a warning when the workbook is empty', () => {
    const result = mapCsvToDraftHints({ type: 'excel', sheets: {} });
    expect(result.fields).toEqual({});
    expect(result.warnings.some((w) => w.includes('no sheets'))).toBe(true);
  });
});
