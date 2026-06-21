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

  test('builds double-span portal frame geometry from engineeringDraft', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'portal-frame',
          geometry: { spanLengthsM: [18, 18], heightM: 9 },
          loads: [
            { kind: 'line', magnitude: 6, unit: 'kN/m', direction: 'gravity', target: 'roof' },
            { kind: 'point', magnitude: 49.03325, unit: 'kN', direction: 'gravity', target: 'crane' },
          ],
        },
      },
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
      message: '',
      llmDraftPatch: {
        inferredType: 'portal-frame',
        spanLengthM: 18,
        heightM: 7,
        loadKN: 6,
        loadType: 'distributed',
        loadPosition: 'full-span',
        skillState: {
          roofLoadKNM: 6,
          mezzanineHeightM: 3,
          mezzanineLoadKN: 4,
        },
      },
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

  test('uses pinned restraints for pinned portal-frame bases', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'portal-frame',
          geometry: { spanLengthsM: [18], heightM: 6 },
          boundary: { frameBaseSupportType: 'pinned' },
          loads: [
            { kind: 'line', magnitude: 6, unit: 'kN/m', direction: 'gravity', target: 'roof' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(model.nodes.filter((node) => String(node.id).startsWith('B')).map((node) => node.restraints)).toEqual([
      [true, true, true, false, false, false],
      [true, true, true, false, false, false],
    ]);
  });
});
