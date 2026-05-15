import { describe, expect, test } from '@jest/globals';

describe('createCalculateTool', () => {
  test('basic arithmetic: addition', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '2 + 3' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(5);
  });

  test('basic arithmetic: multiplication', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '6 * 7' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
  });

  test('basic arithmetic: division', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '15 / 4' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(3.75);
  });

  test('basic arithmetic: power', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '2 ^ 10' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(1024);
  });

  test('basic arithmetic: modulo', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '17 % 5' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(2);
  });

  test('operator precedence: multiplication before addition', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '2 + 3 * 4' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(14);
  });

  test('parentheses override precedence', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '(2 + 3) * 4' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(20);
  });

  test('sqrt function', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'sqrt(144)' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(12);
  });

  test('trigonometric: sin(pi/2)', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'sin(pi / 2)' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBeCloseTo(1);
  });

  test('abs function', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'abs(-5)' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(5);
  });

  test('log(e) equals 1', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'log(e)' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBeCloseTo(1);
  });

  test('pow function', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'pow(2, 10)' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(1024);
  });

  test('engineering formula: simply supported beam max moment', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    // M = wL²/8 for UDL: w=20kN/m, L=6m
    const raw = await tool.invoke({ expression: '20e3 * 6^2 / 8' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(90000);
  });

  test('unit label passes through to output', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '100 * 5', unit: 'kN·m' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.result).toBe(500);
    expect(result.unit).toBe('kN·m');
  });

  test('error on empty expression', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Empty/);
  });

  test('division by zero returns error (Infinity rejected)', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '1 / 0' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a finite number/);
  });

  test('error on unknown function', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'unknownFunc(5)' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
  });

  test('error on unmatched parentheses', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: '(2 + 3' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
  });

  test('error on expression exceeding length limit', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const longExpr = '1 + '.repeat(200) + '1';
    const raw = await tool.invoke({ expression: longExpr });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/limit/);
  });

  test('injection attempt: import is disabled', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'import("fs")' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  test('injection attempt: evaluate is disabled', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'evaluate("1+2")' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  test('injection attempt: parse is disabled', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'parse("1+2")' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  test('injection attempt: config is disabled', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'config({number: "BigNumber"})' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  test('injection attempt: createUnit is disabled', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    const raw = await tool.invoke({ expression: 'createUnit("fakeunit", "1 m")' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  test('scope isolation: variable assignment does not leak', async () => {
    const { createCalculateTool } = await import('../../../dist/agent-langgraph/calc-tool.js');
    const tool = createCalculateTool();
    // Assign a variable
    await tool.invoke({ expression: 'a = 42' });
    // Verify the variable does not persist
    const raw = await tool.invoke({ expression: 'a' });
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
  });
});
