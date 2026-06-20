import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/concrete-frame/handler.js';
import { detectConcreteFrameStructuralType } from '../../../../../dist/agent-skills/structure-type/concrete-frame/detect.js';
import { mergeConcreteFrameState } from '../../../../../dist/agent-skills/structure-type/concrete-frame/merge.js';
import { buildConcreteFrameQuestions } from '../../../../../dist/agent-skills/structure-type/concrete-frame/interaction.js';

describe('concrete-frame handler composed modules', () => {
  test('keeps sticky concrete-frame detection for follow-up messages', () => {
    const match = detectConcreteFrameStructuralType({
      message: '层高3.6m',
      locale: 'zh',
      currentState: {
        inferredType: 'concrete-frame',
        structuralTypeKey: 'concrete-frame',
        supportLevel: 'supported',
        updatedAt: 0,
      },
    });

    expect(match?.skillId).toBe('concrete-frame');
    expect(match?.mappedType).toBe('frame');
  });

  test('does not treat material and sections as critical blockers', () => {
    const missing = handler.computeMissing({
      inferredType: 'concrete-frame',
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 2,
      storyHeightsM: [3, 3],
      bayWidthsM: [6, 6],
      floorLoads: [
        { story: 1, verticalKN: 120, lateralXKN: 30 },
        { story: 2, verticalKN: 120, lateralXKN: 30 },
      ],
      updatedAt: 0,
    }, 'execution');

    expect(missing.critical).toEqual([]);
  });

  test('uses only structured engineeringDraft fields for extraction', () => {
    const patch = handler.extractDraft({
      message: '三层混凝土框架，x方向4跨，间隔6m，每层3m，每层竖向荷载100kN',
      locale: 'zh',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'concrete-frame',
          geometry: {
            storyHeightsM: [3.6, 3.6],
            bayWidthsM: [6],
          },
          material: { family: 'concrete', grade: 'C35', rebarGrade: 'HRB400' },
          sections: { column: '500x500', beam: '300x600' },
          loads: [
            { kind: 'nodal', magnitude: 120, unit: 'kN', direction: 'gravity', target: 'floor' },
          ],
        },
      },
    });

    expect(patch.engineeringDraft).toBeDefined();
    expect(patch.frameDimension).toBe('2d');
    expect(patch.storyCount).toBe(2);
    expect(patch.bayCount).toBe(1);
    expect(patch.frameConcreteGrade).toBe('C35');
    expect(patch.frameRebarGrade).toBe('HRB400');
    expect(patch.frameColumnSection).toBe('500x500');
    expect(patch.frameBeamSection).toBe('300x600');
    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 120, lateralXKN: undefined, lateralYKN: undefined },
      { story: 2, verticalKN: 120, lateralXKN: undefined, lateralYKN: undefined },
    ]);
  });

  test('keeps total-load wording in interaction questions', () => {
    const [question] = buildConcreteFrameQuestions(
      ['floorLoads'],
      ['floorLoads'],
      { inferredType: 'concrete-frame', frameDimension: '2d', updatedAt: 0 },
      'zh',
    );

    expect(question.question).toContain('各层总荷载');
    expect(question.question).not.toContain('节点荷载');
  });

  test('merges y-direction follow-up loads into existing 3d concrete-frame state', () => {
    const state = mergeConcreteFrameState(
      {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        floorLoads: [
          { story: 1, verticalKN: 90, lateralXKN: 18 },
          { story: 2, verticalKN: 90, lateralXKN: 18 },
        ],
        updatedAt: 0,
      },
      {
        inferredType: 'concrete-frame',
        floorLoads: [
          { story: 1, lateralYKN: 12 },
          { story: 2, lateralYKN: 12 },
        ],
      },
    );

    expect(state.floorLoads).toEqual([
      { story: 1, verticalKN: 90, lateralXKN: 18, lateralYKN: 12 },
      { story: 2, verticalKN: 90, lateralXKN: 18, lateralYKN: 12 },
    ]);
  });

  test('does not mark floorLoads missing when llm omits story numbers', () => {
    const patch = handler.extractDraft({
      message: '两层3D混凝土框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，每层总竖向荷载432kN',
      locale: 'zh',
      currentState: undefined,
      llmDraftPatch: {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        storyCount: 2,
        bayCountX: 2,
        bayCountY: 1,
        storyHeightsM: [3.6, 3.6],
        bayWidthsXM: [6, 6],
        bayWidthsYM: [6],
        floorLoads: [
          { verticalKN: 432 },
          { verticalKN: 432 },
        ],
      },
      structuralTypeMatch: {
        key: 'concrete-frame',
        mappedType: 'frame',
        skillId: 'concrete-frame',
        supportLevel: 'supported',
      },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(state.floorLoads).toEqual([
      { story: 1, verticalKN: 432 },
      { story: 2, verticalKN: 432 },
    ]);
    expect(missing.critical).not.toContain('floorLoads');
  });
});

// ============================================================================
// 端到端集成测试 — 模型构建 → 配筋元数据（含净距）→ code-check elementData
// ============================================================================
describe('concrete-frame e2e rebar metadata flow', () => {
  test('buildModel attaches bar_count and sn to beam elements', () => {
    const model = handler.buildModel({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 2,
      storyHeightsM: [3.6, 3.6],
      bayWidthsM: [6, 6],
      floorLoads: [
        { story: 1, verticalKN: 120, lateralXKN: 20 },
        { story: 2, verticalKN: 120, lateralXKN: 20 },
      ],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '500X500',
      frameBeamSection: '300X600',
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    expect(model).toBeDefined();
    const beams = model.elements.filter(e => e.type === 'beam');
    const columns = model.elements.filter(e => e.type === 'column');

    // Beam rebar metadata — stored in element.metadata
    for (const beam of beams) {
      const m = beam.metadata || {};
      expect(m.As).toBeGreaterThan(0);
      expect(m.Asv).toBeGreaterThan(0);
      expect(m.stirrup_dia).toBe(8);
      expect(m.stirrup_spacing).toBe(200);
      expect(m.main_dia).toBeGreaterThanOrEqual(16);
      expect(m.bar_count).toBeGreaterThanOrEqual(2);
      expect(m.sn).toBeGreaterThanOrEqual(0);
      expect(m.cover).toBe(20);
      expect(m.crack_cover).toBe(25);
    }

    // Column rebar metadata — stored in element.metadata
    for (const col of columns) {
      const m = col.metadata || {};
      expect(m.As).toBeGreaterThan(0);
      expect(m.Asv).toBeGreaterThan(0);
      expect(m.stirrup_dia).toBe(8);
      expect(m.stirrup_spacing).toBe(200);
      expect(m.main_dia).toBe(20);
      expect(m.bar_count).toBeGreaterThanOrEqual(4);
      expect(m.sn).toBeGreaterThanOrEqual(0);
      expect(m.cover).toBe(20);
    }
  });

  test('3d model also has bar_count and sn on X/Y beams and columns', () => {
    const model = handler.buildModel({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 2,
      bayCountY: 1,
      storyHeightsM: [3.6, 3.6],
      bayWidthsXM: [6, 6],
      bayWidthsYM: [5],
      floorLoads: [
        { story: 1, verticalKN: 360, liveLoadKN: 120 },
        { story: 2, verticalKN: 360, liveLoadKN: 120 },
      ],
      frameConcreteGrade: 'C35',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '600X600',
      frameBeamSection: '350X700',
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    expect(model).toBeDefined();
    expect(model.frameDimension).toBe('3d');

    const xBeams = model.elements.filter(e => e.id.startsWith('BX'));
    const yBeams = model.elements.filter(e => e.id.startsWith('BY'));
    const columns = model.elements.filter(e => e.type === 'column');

    expect(xBeams.length).toBeGreaterThan(0);
    expect(yBeams.length).toBeGreaterThan(0);
    expect(columns.length).toBeGreaterThan(0);

    // All X-beams have bar_count + sn in metadata
    for (const b of xBeams) {
      const m = b.metadata || {};
      expect(m.bar_count).toBeGreaterThanOrEqual(2);
      expect(m.sn).toBeGreaterThanOrEqual(0);
      expect(m.main_dia).toBe(25); // H=700 ≥ 600 → d25
    }

    // All Y-beams have bar_count + sn in metadata
    for (const b of yBeams) {
      const m = b.metadata || {};
      expect(m.bar_count).toBeGreaterThanOrEqual(2);
      expect(m.sn).toBeGreaterThanOrEqual(0);
    }

    // All columns have bar_count + sn in metadata (4+ bars around perimeter)
    for (const c of columns) {
      const m = c.metadata || {};
      expect(m.bar_count).toBeGreaterThanOrEqual(4);
      expect(m.sn).toBeGreaterThanOrEqual(0);
    }
  });

  test('net spacing sn is reasonable for 500X500 C30 column', () => {
    // 500×500 column, C30, 20mm bars → ~8 bars total, ~2 per side face
    // available width = 500 - 2*(20+8) = 444mm
    // bar footprint per side = 2*20 = 40mm
    // sn = (444 - 40) / (2-1) = 404mm (plenty of space → utilization < 1.0)
    const model = handler.buildModel({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 1,
      storyHeightsM: [3.6, 3.6, 3.6],
      bayWidthsM: [6],
      floorLoads: [
        { story: 1, verticalKN: 100 },
        { story: 2, verticalKN: 100 },
        { story: 3, verticalKN: 100 },
      ],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '500X500',
      frameBeamSection: '300X600',
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const column = model.elements.find(e => e.type === 'column');
    expect(column).toBeDefined();
    // Rebar metadata is in element.metadata
    const cm = column.metadata || {};
    // 500mm column → sn limit = max(1.5*20, 50) = 50mm
    // Actual sn should be >> 50mm for a well-sized column
    expect(cm.sn).toBeGreaterThan(50);
    expect(cm.bar_count).toBeGreaterThanOrEqual(4);
  });
});
