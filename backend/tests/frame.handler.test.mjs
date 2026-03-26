import { describe, expect, test } from '@jest/globals';
import { AgentSkillLoader } from '../dist/agent-runtime/loader.js';

async function loadFrameHandler() {
  const loader = new AgentSkillLoader();
  const plugins = await loader.loadPlugins();
  const frame = plugins.find((p) => p.id === 'frame');
  if (!frame) {
    throw new Error('frame plugin not found');
  }
  return frame.handler;
}

describe('frame handler – P0-1: load extraction regex', () => {
  test('should extract vertical load from compact "每层竖向100kN" without "荷载"', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '3层2跨钢框架，层高3.6m，跨度6m，每层竖向100kN水平50kN，柱脚固定',
      locale: 'zh',
      scenario: { key: 'steel-frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.floorLoads).toBeDefined();
    expect(patch.floorLoads.length).toBeGreaterThan(0);
    expect(patch.floorLoads[0].verticalKN).toBe(100);
  });

  test('should extract lateral load from compact "水平50kN" without "荷载"', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '3层2跨钢框架，层高3.6m，跨度6m，每层竖向100kN水平50kN，柱脚固定',
      locale: 'zh',
      scenario: { key: 'steel-frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.floorLoads).toBeDefined();
    expect(patch.floorLoads[0].lateralXKN).toBe(50);
  });

  test('should extract standalone "竖向200kN"', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '竖向200kN',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', storyCount: 3, updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.floorLoads).toBeDefined();
    expect(patch.floorLoads[0].verticalKN).toBe(200);
  });

  test('should still match original format "每层荷载100kN"', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '每层荷载100kN',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', storyCount: 2, updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.floorLoads).toBeDefined();
    expect(patch.floorLoads[0].verticalKN).toBe(100);
  });

  test('should still match "水平荷载50kN" with 荷载 keyword', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '水平荷载50kN',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', storyCount: 2, updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.floorLoads).toBeDefined();
    expect(patch.floorLoads[0].lateralXKN).toBe(50);
  });
});

describe('frame handler – P0-2: multi-turn conversation fallback', () => {
  test('should continue frame scenario when follow-up message lacks "框架" keyword', async () => {
    const handler = await loadFrameHandler();
    const currentState = {
      inferredType: 'frame',
      skillId: 'frame',
      scenarioKey: 'steel-frame',
      updatedAt: Date.now(),
    };
    const result = handler.detectScenario({
      message: 'x向3跨，跨度分别6m、9m、6m，y向2跨，跨度分别5m、7m',
      locale: 'zh',
      currentState,
    });
    expect(result).not.toBeNull();
    expect(result.mappedType).toBe('frame');
    expect(result.skillId).toBe('frame');
    expect(result.key).toBe('steel-frame');
    expect(result.supportLevel).toBe('supported');
  });

  test('should preserve frame scenarioKey on follow-up without keywords', async () => {
    const handler = await loadFrameHandler();
    const currentState = {
      inferredType: 'frame',
      skillId: 'frame',
      scenarioKey: 'frame',
      updatedAt: Date.now(),
    };
    const result = handler.detectScenario({
      message: '每层竖向荷载200kN',
      locale: 'zh',
      currentState,
    });
    expect(result).not.toBeNull();
    expect(result.key).toBe('frame');
    expect(result.mappedType).toBe('frame');
  });

  test('should return null when no currentState and no keywords', async () => {
    const handler = await loadFrameHandler();
    const result = handler.detectScenario({
      message: '每层竖向荷载200kN',
      locale: 'zh',
    });
    expect(result).toBeNull();
  });

  test('should still detect "钢框架" directly on first turn', async () => {
    const handler = await loadFrameHandler();
    const result = handler.detectScenario({
      message: '3层2跨钢框架',
      locale: 'zh',
    });
    expect(result).not.toBeNull();
    expect(result.key).toBe('steel-frame');
    expect(result.mappedType).toBe('frame');
  });

  test('should still reject irregular frame even with existing state', async () => {
    const handler = await loadFrameHandler();
    const currentState = {
      inferredType: 'frame',
      skillId: 'frame',
      scenarioKey: 'frame',
      updatedAt: Date.now(),
    };
    const result = handler.detectScenario({
      message: '这个框架有退台',
      locale: 'zh',
      currentState,
    });
    expect(result).not.toBeNull();
    expect(result.supportLevel).toBe('unsupported');
  });
});

describe('frame handler – P1: unequal bay width array extraction', () => {
  test('should extract "跨度分别6m、9m、6m" as bayWidthsXM array', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: 'x向3跨，跨度分别6m、9m、6m，y向2跨，跨度分别5m、7m',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.bayWidthsXM).toEqual([6, 9, 6]);
    expect(patch.bayWidthsYM).toEqual([5, 7]);
  });

  test('should infer bayCountX from array length', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: 'x向跨度分别6m、9m、6m',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.bayWidthsXM).toEqual([6, 9, 6]);
    expect(patch.bayCountX).toBe(3);
  });

  test('should infer 3d when y-direction array is present', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: 'x向跨度分别6m、9m，y向跨度分别5m、7m',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.frameDimension).toBe('3d');
    expect(patch.bayWidthsYM).toEqual([5, 7]);
  });

  test('should extract unequal story heights "层高分别4.5m、3.6m、3.6m"', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '3层框架，层高分别4.5m、3.6m、3.6m，2跨每跨6m',
      locale: 'zh',
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.storyHeightsM).toEqual([4.5, 3.6, 3.6]);
  });

  test('should still work with equal spans via repeatScalar', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: '3层2跨框架，层高3.6m，跨度6m',
      locale: 'zh',
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.storyHeightsM).toEqual([3.6, 3.6, 3.6]);
    expect(patch.bayWidthsM).toEqual([6, 6]);
  });

  test('should handle comma-separated format "6m,9m,6m"', async () => {
    const handler = await loadFrameHandler();
    const patch = handler.extractDraft({
      message: 'x向跨度分别6m,9m,6m',
      locale: 'zh',
      currentState: { inferredType: 'frame', skillId: 'frame', updatedAt: Date.now() },
      scenario: { key: 'frame', mappedType: 'frame', skillId: 'frame', supportLevel: 'supported' },
    });
    expect(patch.bayWidthsXM).toEqual([6, 9, 6]);
  });
});
