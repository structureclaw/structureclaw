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
    expect(match?.mappedType).toBe('concrete-frame');
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
        mappedType: 'concrete-frame',
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