import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('jsonSchemaToZod', () => {
  test('converts string property', async () => {
    const { jsonSchemaToZod } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(schema.safeParse({ name: 'test' }).success).toBe(true);
    expect(schema.safeParse({ name: 123 }).success).toBe(false);
  });

  test('converts number and integer properties', async () => {
    const { jsonSchemaToZod } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        count: { type: 'integer' },
        ratio: { type: 'number' },
      },
      required: ['count', 'ratio'],
    });
    expect(schema.safeParse({ count: 5, ratio: 3.14 }).success).toBe(true);
    expect(schema.safeParse({ count: 5.5, ratio: 3.14 }).success).toBe(false);
  });

  test('converts boolean property', async () => {
    const { jsonSchemaToZod } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { active: { type: 'boolean' } },
      required: ['active'],
    });
    expect(schema.safeParse({ active: true }).success).toBe(true);
    expect(schema.safeParse({ active: 'yes' }).success).toBe(false);
  });

  test('converts array of strings', async () => {
    const { jsonSchemaToZod } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      required: ['items'],
    });
    expect(schema.safeParse({ items: ['a', 'b'] }).success).toBe(true);
    expect(schema.safeParse({ items: [1, 2] }).success).toBe(false);
  });

  test('optional fields are not required', async () => {
    const { jsonSchemaToZod } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        required_field: { type: 'string' },
        optional_field: { type: 'string' },
      },
      required: ['required_field'],
    });
    expect(schema.safeParse({ required_field: 'hello' }).success).toBe(true);
  });

  test('unknown type falls back to z.unknown()', async () => {
    const { jsonSchemaToZod } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { data: { type: 'custom_unknown' } },
      required: ['data'],
    });
    expect(schema.safeParse({ data: 'anything' }).success).toBe(true);
    expect(schema.safeParse({ data: 42 }).success).toBe(true);
  });
});

describe('loadUserTools', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sclaw-user-tools-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('nonexistent directory returns empty result', async () => {
    const { loadUserTools } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const result = await loadUserTools(path.join(tmpDir, 'no-such-dir'));
    expect(result.tools).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test('missing tool.yaml reports missing_yaml', async () => {
    const { loadUserTools } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const toolDir = path.join(tmpDir, 'my-tool');
    await fs.mkdir(toolDir, { recursive: true });
    const result = await loadUserTools(tmpDir);
    expect(result.tools).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe('missing_yaml');
  });

  test('invalid YAML reports invalid_yaml', async () => {
    const { loadUserTools } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const toolDir = path.join(tmpDir, 'bad-tool');
    await fs.mkdir(toolDir, { recursive: true });
    await fs.writeFile(path.join(toolDir, 'tool.yaml'), 'invalid: [yaml: content', 'utf8');
    const result = await loadUserTools(tmpDir);
    expect(result.failures[0].reason).toBe('invalid_yaml');
  });

  test('missing tool.js reports missing_js', async () => {
    const { loadUserTools } = await import('../../../dist/agent-langgraph/user-tool-loader.js');
    const toolDir = path.join(tmpDir, 'no-js-tool');
    await fs.mkdir(toolDir, { recursive: true });
    await fs.writeFile(path.join(toolDir, 'tool.yaml'), [
      'id: test_tool',
      'category: engineering',
      'risk: low',
      'defaultEnabled: true',
      'displayName: { zh: "测试", en: "Test" }',
      'description: { zh: "测试工具", en: "Test tool" }',
      'parameters:',
      '  type: object',
      '  properties:',
      '    input:',
      '      type: string',
      '  required: [input]',
    ].join('\n'), 'utf8');
    const result = await loadUserTools(tmpDir);
    expect(result.failures[0].reason).toBe('missing_js');
  });
});
