import { describe, expect, test } from '@jest/globals';
import {
  applySectionShape,
  computeLinearScale,
  extractMemberFailures,
  proposeLocalRuleDesign,
} from '../../../../dist/agent-skills/design/provider.js';

function buildFrameModel() {
  return {
    schema_version: '2.0.0',
    elements: [
      { id: 'C1', type: 'column', nodes: ['N0_0', 'N1_0'], material: '1', section: '1' },
      { id: 'C2', type: 'column', nodes: ['N0_1', 'N1_1'], material: '1', section: '1' },
      { id: 'B1', type: 'beam', nodes: ['N1_0', 'N1_1'], material: '1', section: '2' },
    ],
    sections: [
      {
        id: '1', name: 'HW200X200', type: 'H', purpose: 'column',
        shape: { kind: 'H', H: 200, B: 200, tw: 8, tf: 12 },
        properties: { A: 0.0064, Iy: 4.72e-5, Iz: 1.6e-5, J: 1.7e-6, G: 79000 },
      },
      {
        id: '2', name: 'HN300X150', type: 'H', purpose: 'beam',
        shape: { kind: 'H', H: 300, B: 150, tw: 6.5, tf: 9 },
        properties: { A: 0.00487, Iy: 7.21e-5, Iz: 5.08e-6, J: 5.18e-7, G: 79000 },
      },
    ],
    metadata: { columnSection: 'HW200X200', beamSection: 'HN300X150' },
  };
}

function codeCheckWithFailures() {
  return {
    code: 'GB50017',
    status: 'success',
    summary: { total: 4, passed: 2, failed: 2, maxUtilization: 1.25, controllingElement: 'C1', controllingCheck: 'strength' },
    details: [
      {
        elementId: 'C1',
        elementType: 'column',
        status: 'fail',
        checks: [
          {
            items: [
              { item: 'strength', status: 'fail', utilization: 1.25, clause: '7.1.1' },
              { item: 'slenderness', status: 'pass', utilization: 0.5, clause: '7.4.6' },
            ],
          },
        ],
        controlling: { item: 'strength', utilization: 1.25, clause: '7.1.1' },
      },
      {
        elementId: 'C2',
        elementType: 'column',
        status: 'pass',
        checks: [{ items: [{ item: 'strength', status: 'pass', utilization: 0.9, clause: '7.1.1' }] }],
        controlling: { item: 'strength', utilization: 0.9 },
      },
      {
        elementId: 'B1',
        elementType: 'beam',
        status: 'pass',
        checks: [{ items: [{ item: 'moment', status: 'pass', utilization: 0.8, clause: '6.1.1' }] }],
        controlling: { item: 'moment', utilization: 0.8 },
      },
    ],
  };
}

describe('design member failure extraction', () => {
  test('collects the worst failing utilization per element from details', () => {
    const failures = extractMemberFailures(codeCheckWithFailures());
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ elementId: 'C1', utilization: 1.25, clause: '7.1.1' });
  });

  test('falls back to the code-check summary when details are absent', () => {
    const failures = extractMemberFailures({
      summary: { total: 2, failed: 1, maxUtilization: 1.4, controllingElement: 'B9' },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ elementId: 'B9', utilization: 1.4 });
  });

  test('falls back to the analysis envelope utilization map', () => {
    const analysis = { data: { envelope: { elementUtilization: { C1: 1.1, C2: 0.9 } } } };
    const failures = extractMemberFailures(analysis);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ elementId: 'C1', utilization: 1.1 });
  });

  test('returns nothing when every member passes', () => {
    expect(extractMemberFailures({ summary: { total: 3, failed: 0, maxUtilization: 0.8 } })).toHaveLength(0);
  });
});

describe('local rule-based design engine', () => {
  test('upgrades only the sections of failing members', async () => {
    const model = buildFrameModel();
    const result = await proposeLocalRuleDesign({ model, codeCheck: codeCheckWithFailures() });

    expect(result.provider).toBe('local-rule');
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0];
    expect(change.sectionId).toBe('1');
    expect(change.elementIds).toEqual(['C1']);
    expect(change.before).toBe('HW200X200');
    expect(change.after).toMatch(/^HW\d+X\d+$/);
    expect(change.utilizationBefore).toBeCloseTo(1.25, 3);
    expect(change.utilizationAfter).toBeLessThan(1.25);
    expect(result.maxUtilizationBefore).toBeCloseTo(1.25, 3);

    const upgraded = result.model.sections.find((section) => section.id === '1');
    const untouched = result.model.sections.find((section) => section.id === '2');
    expect(upgraded.shape.H).toBeGreaterThan(200);
    expect(upgraded.shape.B).toBeGreaterThan(200);
    expect(upgraded.properties.A).toBeGreaterThan(0.0064);
    expect(upgraded.properties.Iy).toBeGreaterThan(4.72e-5);
    expect(untouched.name).toBe('HN300X150');
    expect(result.model.metadata.columnSection).toBe(change.after);
    expect(result.model.metadata.beamSection).toBe('HN300X150');
    // original model untouched (immutability)
    expect(model.sections.find((section) => section.id === '1').shape.H).toBe(200);
  });

  test('scale grows with utilization and stays bounded', () => {
    expect(computeLinearScale(1.0)).toBeCloseTo(Math.sqrt(1.05), 5);
    expect(computeLinearScale(1.44)).toBeGreaterThan(computeLinearScale(1.1));
    expect(computeLinearScale(20)).toBeLessThanOrEqual(2);
  });

  test('returns no changes when the code check passes', async () => {
    const model = buildFrameModel();
    const passingCheck = {
      summary: { total: 4, passed: 4, failed: 0, maxUtilization: 0.8 },
      details: [],
    };
    const result = await proposeLocalRuleDesign({ model, codeCheck: passingCheck });
    expect(result.changes).toHaveLength(0);
    expect(result.model).toBe(model);
  });

  test('skips sections whose shape cannot be parsed', async () => {
    const model = buildFrameModel();
    model.sections = [{ id: '1', name: 'custom', shape: { kind: 'H', H: 200, B: 200 } }];
    const result = await proposeLocalRuleDesign({ model, codeCheck: codeCheckWithFailures() });
    expect(result.changes).toHaveLength(0);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test('reports no-change when a section is already at the size limit', async () => {
    const model = buildFrameModel();
    model.sections = [{
      id: '1', name: 'HW2400X2400', type: 'H', purpose: 'column',
      shape: { kind: 'H', H: 2400, B: 2400, tw: 40, tf: 60 },
      properties: { A: 1.0, Iy: 1.0, Iz: 1.0, J: 1.0, G: 79000 },
    }];
    const result = await proposeLocalRuleDesign({ model, codeCheck: codeCheckWithFailures() });
    expect(result.changes).toHaveLength(0);
    expect(result.notes.some((note) => note.includes('size limit'))).toBe(true);
  });

  test('applySectionShape recomputes rectangular properties and dimensions', () => {
    const updated = applySectionShape(
      { id: '2', name: '500X500', type: 'rectangular', purpose: 'column', shape: { kind: 'rectangular', H: 500, B: 500 }, properties: { A: 0.25 } },
      { kind: 'rectangular', H: 600, B: 600 },
      '600X600',
    );
    expect(updated.name).toBe('600X600');
    expect(updated.width).toBeCloseTo(0.6, 5);
    expect(updated.height).toBeCloseTo(0.6, 5);
    expect(updated.properties.A).toBeCloseTo(0.36, 5);
    expect(updated.properties.Iy).toBeCloseTo(0.6 * 0.6 ** 3 / 12, 5);
  });
});
