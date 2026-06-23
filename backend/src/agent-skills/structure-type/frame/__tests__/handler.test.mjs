import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/frame/handler.js';
import { detectFrameStructuralType } from '../../../../../dist/agent-skills/structure-type/frame/detect.js';
import { mergeFrameState } from '../../../../../dist/agent-skills/structure-type/frame/merge.js';
import { buildFrameQuestions } from '../../../../../dist/agent-skills/structure-type/frame/interaction.js';

describe('frame handler composed modules', () => {
  test('leaves follow-up sticky routing to the runtime registry', () => {
    const match = detectFrameStructuralType({
      message: '层高3.6m',
      locale: 'zh',
      currentState: {
        inferredType: 'frame',
        structuralTypeKey: 'frame',
        supportLevel: 'supported',
        updatedAt: 0,
      },
    });

    expect(match).toBeNull();
  });

  test('does not treat material and sections as critical blockers', () => {
    const missing = handler.computeMissing({
      inferredType: 'frame',
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

  test('keeps total-load wording in interaction questions', () => {
    const [question] = buildFrameQuestions(
      ['floorLoads'],
      ['floorLoads'],
      { inferredType: 'frame', frameDimension: '2d', updatedAt: 0 },
      'zh',
    );

    expect(question.question).toContain('各层总荷载');
    expect(question.question).not.toContain('节点荷载');
  });

  test('merges y-direction follow-up loads into existing 3d frame state', () => {
    const state = mergeFrameState(
      {
        inferredType: 'frame',
        frameDimension: '3d',
        floorLoads: [
          { story: 1, verticalKN: 90, lateralXKN: 18 },
          { story: 2, verticalKN: 90, lateralXKN: 18 },
        ],
        updatedAt: 0,
      },
      {
        inferredType: 'frame',
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

  test('preserves wind design parameters through frame state merge', () => {
    const state = mergeFrameState(
      {
        inferredType: 'frame',
        frameDimension: '2d',
        storyCount: 2,
        storyHeightsM: [3.6, 3.6],
        bayCount: 1,
        bayWidthsM: [6],
        floorLoads: [
          { story: 1, verticalKN: 120 },
          { story: 2, verticalKN: 120 },
        ],
        updatedAt: 0,
      },
      {
        inferredType: 'frame',
        wind: { basicPressureKNM2: 0.5, terrainRoughness: 'B' },
        floorLoads: [
          { story: 1, lateralXKN: 10.8 },
          { story: 2, lateralXKN: 10.8 },
        ],
      },
    );

    expect(state.wind).toEqual({ basicPressureKNM2: 0.5, terrainRoughness: 'B' });
    expect(state.floorLoads).toEqual([
      { story: 1, verticalKN: 120, lateralXKN: 10.8 },
      { story: 2, verticalKN: 120, lateralXKN: 10.8 },
    ]);
  });

  test('does not mark floorLoads missing when llm omits story numbers', () => {
    const patch = handler.extractDraft({
      message: '两层3D钢框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，每层总竖向荷载432kN',
      locale: 'zh',
      currentState: undefined,
      llmDraftPatch: {
        inferredType: 'frame',
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
        key: 'frame',
        mappedType: 'frame',
        skillId: 'frame',
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

  test('does not mark floorLoads missing when semantic line loads are present', () => {
    const patch = handler.extractDraft({
      message: '两层单跨钢框架，跨度6m，层高3.6m，梁上均布荷载60kN/m',
      locale: 'zh',
      currentState: undefined,
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'steel-frame',
          geometry: {
            storyHeightsM: [3.6, 3.6],
            bayWidthsM: [6],
          },
          loads: [
            { kind: 'line', magnitude: 60, unit: 'kN/m', direction: 'gravity' },
          ],
        },
      },
      structuralTypeMatch: {
        key: 'frame',
        mappedType: 'frame',
        skillId: 'frame',
        supportLevel: 'supported',
      },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(state.floorLoads).toBeUndefined();
    expect(missing.critical).not.toContain('floorLoads');
  });

  test('preserves existing floor loads when semantic line loads are added', () => {
    const patch = handler.extractDraft({
      message: '增加梁上均布荷载60kN/m',
      locale: 'zh',
      currentState: {
        inferredType: 'frame',
        structuralTypeKey: 'frame',
        frameDimension: '2d',
        storyCount: 2,
        bayCount: 1,
        storyHeightsM: [3.6, 3.6],
        bayWidthsM: [6],
        floorLoads: [
          { story: 1, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 },
          { story: 2, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 },
        ],
        updatedAt: 0,
      },
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'steel-frame',
          loads: [
            { kind: 'line', magnitude: 60, unit: 'kN/m', direction: 'gravity' },
          ],
        },
      },
      structuralTypeMatch: {
        key: 'frame',
        mappedType: 'frame',
        skillId: 'frame',
        supportLevel: 'supported',
      },
    });
    const state = handler.mergeState({
      inferredType: 'frame',
      structuralTypeKey: 'frame',
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3.6, 3.6],
      bayWidthsM: [6],
      floorLoads: [
        { story: 1, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 },
        { story: 2, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 },
      ],
      updatedAt: 0,
    }, patch);

    expect(state.floorLoads).toEqual([
      { story: 1, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 },
      { story: 2, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 },
    ]);
  });

  test('drops same-patch stale dead floor loads when semantic line loads are present', () => {
    const existingState = {
      inferredType: 'frame',
      structuralTypeKey: 'frame',
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      storyHeightsM: [3.6],
      bayWidthsM: [6],
      updatedAt: 0,
    };
    const patch = handler.extractDraft({
      message: '梁上均布荷载60kN/m，同时活荷载72kN',
      locale: 'zh',
      currentState: existingState,
      llmDraftPatch: {
        floorLoads: [{ story: 1, verticalKN: 360, liveLoadKN: 72, lateralXKN: 20 }],
        engineeringDraft: {
          structureType: 'steel-frame',
          loads: [
            { kind: 'line', magnitude: 60, unit: 'kN/m', direction: 'gravity' },
          ],
        },
      },
      structuralTypeMatch: {
        key: 'frame',
        mappedType: 'frame',
        skillId: 'frame',
        supportLevel: 'supported',
      },
    });
    const state = handler.mergeState(existingState, patch);

    expect(state.floorLoads).toEqual([
      { story: 1, liveLoadKN: 72, lateralXKN: 20 },
    ]);
  });

  test('does not treat non-gravity line loads as executable gravity loads', () => {
    const missing = handler.computeMissing({
      inferredType: 'frame',
      structuralTypeKey: 'frame',
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3.6, 3.6],
      bayWidthsM: [6],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 20, unit: 'kN/m', direction: 'globalX' },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    }, 'execution');

    expect(missing.critical).toContain('floorLoads');
  });

  test('preserves uneven 2d bay widths from an llm draft patch', () => {
    const patch = handler.extractDraft({
      message: '3层2跨框架，层高3.3m，跨度5.4m和6m，每层楼面荷载15kN/m，请进行静力分析',
      locale: 'zh',
      currentState: undefined,
      llmDraftPatch: {
        inferredType: 'frame',
        frameDimension: '2d',
        storyCount: 3,
        bayCount: 2,
        storyHeightsM: [3.3, 3.3, 3.3],
        bayWidthsM: [5.4, 6],
        floorLoads: [
          { story: 1, verticalKN: 171 },
          { story: 2, verticalKN: 171 },
          { story: 3, verticalKN: 171 },
        ],
      },
      structuralTypeMatch: {
        key: 'frame',
        mappedType: 'frame',
        skillId: 'frame',
        supportLevel: 'supported',
      },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.bayWidthsM).toEqual([5.4, 6]);
    expect(state.bayCount).toBe(2);
  });
});
