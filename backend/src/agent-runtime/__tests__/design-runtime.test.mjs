import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

// Isolate settings.json so the ai-structure integration state (enabled /
// disabled) is deterministic in tests.
const previousDataDir = process.env.SCLAW_DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-design-runtime-'));
process.env.SCLAW_DATA_DIR = tempDir;

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.SCLAW_DATA_DIR;
  else process.env.SCLAW_DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function buildFailingFrameModel() {
  return {
    schema_version: '2.0.0',
    elements: [
      { id: 'C1', type: 'column', section: '1' },
      { id: 'B1', type: 'beam', section: '2' },
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
    metadata: { columnSection: 'HW200X200' },
  };
}

function buildFailingCodeCheck() {
  return {
    summary: { total: 2, passed: 1, failed: 1, maxUtilization: 1.25, controllingElement: 'C1' },
    details: [
      {
        elementId: 'C1', status: 'fail',
        checks: [{ items: [{ item: 'strength', status: 'fail', utilization: 1.25, clause: '7.1.1' }] }],
        controlling: { item: 'strength', utilization: 1.25, clause: '7.1.1' },
      },
    ],
  };
}

describe('AgentSkillRuntime.executeDesignSkill', () => {
  let runtime;

  beforeAll(async () => {
    const { AgentSkillRuntime } = await import('../../../dist/agent-runtime/index.js');
    runtime = new AgentSkillRuntime();
  });

  test('design-ai-structure skill is discovered as a design-domain skill', async () => {
    const manifests = await runtime.listSkillManifests();
    const designSkill = manifests.find((skill) => skill.id === 'design-ai-structure');
    expect(designSkill).toBeDefined();
    expect(designSkill.domain).toBe('design');
    expect(designSkill.stages).toContain('design');
  });

  test('unselected design skills fall back to the local rule engine', async () => {
    const result = await runtime.executeDesignSkill({
      input: {
        model: buildFailingFrameModel(),
        codeCheck: buildFailingCodeCheck(),
        iteration: 1,
        maxIterations: 10,
        locale: 'zh',
        approved: true,
      },
      skillIds: ['frame'],
    });
    expect(result.provider).toBe('local-rule');
    expect(result.action).toBe('iterate');
    expect(result.applied).toBe(true);
    expect(result.model.sections.find((section) => section.id === '1').shape.H).toBeGreaterThan(200);
    expect(result.summary.zh).toContain('HW200X200');
    expect(result.summary.en).toContain('HW200X200');
  });

  test('routes through the ai-structure skill handler, which falls back locally when disabled', async () => {
    const result = await runtime.executeDesignSkill({
      input: {
        model: buildFailingFrameModel(),
        codeCheck: buildFailingCodeCheck(),
        iteration: 1,
        maxIterations: 10,
        locale: 'en',
        approved: true,
      },
      skillIds: ['design-ai-structure'],
    });
    expect(result.provider).toBe('design-ai-structure');
    expect(result.action).toBe('iterate');
    expect(result.applied).toBe(true);
    // the service is disabled in the isolated settings → local engine result
    expect(result.providerMeta?.notes?.length ?? 0).toBeGreaterThan(0);
  });

  test('unapproved proposals are returned unapplied for user approval', async () => {
    const result = await runtime.executeDesignSkill({
      input: {
        model: buildFailingFrameModel(),
        codeCheck: buildFailingCodeCheck(),
        iteration: 1,
        maxIterations: 10,
        locale: 'zh',
        approved: false,
      },
      skillIds: ['design-ai-structure'],
    });
    expect(result.action).toBe('blocked_approval');
    expect(result.applied).toBe(false);
    expect(result.model).toBeUndefined();
    expect(result.changes.length).toBeGreaterThan(0);
  });

  test('reports no_change when the code check has no failing members', async () => {
    const result = await runtime.executeDesignSkill({
      input: {
        model: buildFailingFrameModel(),
        codeCheck: { summary: { total: 4, passed: 4, failed: 0, maxUtilization: 0.7 } },
        iteration: 2,
        maxIterations: 10,
        locale: 'en',
        approved: true,
      },
      skillIds: ['design-ai-structure'],
    });
    expect(result.action).toBe('no_change');
    expect(result.applied).toBe(false);
  });
});
