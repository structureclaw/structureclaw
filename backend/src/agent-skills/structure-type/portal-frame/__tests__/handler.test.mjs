import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/portal-frame/handler.js';

describe('portal-frame handler', () => {
  test('detects portal-frame requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '门式刚架，跨度18m，高度6m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('portal-frame');
    expect(match?.mappedType).toBe('portal-frame');
  });

  test('keeps portal-frame load-position guidance deterministic', () => {
    const [question] = handler.buildQuestions(
      ['loadPosition'],
      ['loadPosition'],
      { inferredType: 'portal-frame', updatedAt: 0 },
      'zh',
    );

    expect(question.suggestedValue).toBe('full-span');
    expect(question.question).toContain('full-span');
  });

  test('builds double-span portal frame geometry from 2x span wording', () => {
    const patch = handler.extractDraft({
      message: '双跨门式刚架，跨度2x18m，高度9m，设5t吊车，屋面荷载6kN/m，做静力分析',
      llmDraftPatch: { inferredType: 'portal-frame' },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(state.skillState).toEqual(expect.objectContaining({
      portalBaySpansM: [18, 18],
      portalBayCount: 2,
      roofLoadKNM: 6,
    }));
    expect(model.nodes).toHaveLength(6);
    expect(model.elements).toHaveLength(5);
    expect(model.metadata.geometry.spanLengthsM).toEqual([18, 18]);
    expect(model.load_cases[0].loads).toEqual(expect.arrayContaining([
      expect.objectContaining({ element: 'R0', wz: -6 }),
      expect.objectContaining({ node: 'T1', fz: expect.any(Number) }),
    ]));
  });

  test('builds a simple mezzanine portal-frame idealization', () => {
    const patch = handler.extractDraft({
      message: '门式刚架，跨度18m，檐口高度7m，一侧设3m高夹层，屋面荷载6kN/m，夹层荷载4kN/m2，做静力分析',
      llmDraftPatch: { inferredType: 'portal-frame' },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(model.nodes).toHaveLength(6);
    expect(model.elements).toHaveLength(5);
    expect(model.metadata).toEqual(expect.objectContaining({ hasMezzanine: true }));
    expect(model.load_cases[0].loads).toEqual(expect.arrayContaining([
      expect.objectContaining({ element: 'R0', wz: -6 }),
      { node: 'M1', fz: -4 },
    ]));
  });
});
