import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('file-tools helpers', () => {
  describe('isPathWithinRoot', () => {
    test('exact root match returns true', async () => {
      const { isPathWithinRoot } = await import('../../../dist/agent-langgraph/file-tools.js');
      const root = path.resolve('/tmp/test-root');
      expect(isPathWithinRoot(root, root)).toBe(true);
    });

    test('strict descendant returns true', async () => {
      const { isPathWithinRoot } = await import('../../../dist/agent-langgraph/file-tools.js');
      const root = path.resolve('/tmp/test-root');
      expect(isPathWithinRoot(path.join(root, 'sub', 'file.txt'), root)).toBe(true);
    });

    test('sibling directory returns false', async () => {
      const { isPathWithinRoot } = await import('../../../dist/agent-langgraph/file-tools.js');
      const root = path.resolve('/tmp/test-root');
      expect(isPathWithinRoot(path.resolve('/tmp/test-other/file.txt'), root)).toBe(false);
    });

    test('traversal via ../ returns false', async () => {
      const { isPathWithinRoot } = await import('../../../dist/agent-langgraph/file-tools.js');
      const root = path.resolve('/tmp/test-root');
      const traversal = path.normalize(path.join(root, '..', 'outside.txt'));
      expect(isPathWithinRoot(traversal, root)).toBe(false);
    });
  });

  describe('parseCsv', () => {
    test('empty input returns empty headers and rows', async () => {
      const { parseCsv } = await import('../../../dist/agent-langgraph/file-tools.js');
      const result = parseCsv('', 100);
      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    test('single row returns headers only', async () => {
      const { parseCsv } = await import('../../../dist/agent-langgraph/file-tools.js');
      const result = parseCsv('a,b,c', 100);
      expect(result.headers).toEqual(['a', 'b', 'c']);
      expect(result.rows).toEqual([]);
    });

    test('quoted fields with commas are preserved', async () => {
      const { parseCsv } = await import('../../../dist/agent-langgraph/file-tools.js');
      const result = parseCsv('name,value\n"Smith, John",100', 100);
      expect(result.headers).toEqual(['name', 'value']);
      expect(result.rows[0][0]).toBe('Smith, John');
      expect(result.rows[0][1]).toBe('100');
    });

    test('tab-separated input splits on tabs', async () => {
      const { parseCsv } = await import('../../../dist/agent-langgraph/file-tools.js');
      const result = parseCsv('a\tb\tc\n1\t2\t3', 100);
      expect(result.headers).toEqual(['a', 'b', 'c']);
      expect(result.rows[0]).toEqual(['1', '2', '3']);
    });

    test('rows are truncated at maxRows', async () => {
      const { parseCsv } = await import('../../../dist/agent-langgraph/file-tools.js');
      const lines = ['h'].concat(Array.from({ length: 20 }, (_, i) => `${i}`));
      const result = parseCsv(lines.join('\n'), 5);
      expect(result.rows).toHaveLength(5);
    });
  });

  describe('parseDxf', () => {
    test('extracts LINE entities with coordinates', async () => {
      const { parseDxf } = await import('../../../dist/agent-langgraph/file-tools.js');
      const dxf = [
        '0', 'LINE',
        '10', '1.0', '20', '2.0',
        '11', '3.0', '21', '4.0',
        '0', 'EOF',
      ].join('\n');
      const result = parseDxf(dxf);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
    });

    test('extracts TEXT and MTEXT content', async () => {
      const { parseDxf } = await import('../../../dist/agent-langgraph/file-tools.js');
      const dxf = [
        '0', 'TEXT',
        '1', 'Hello World',
        '0', 'MTEXT',
        '1', 'Beam Label',
        '0', 'EOF',
      ].join('\n');
      const result = parseDxf(dxf);
      expect(result.entityCount).toBeGreaterThanOrEqual(2);
      expect(result.texts).toEqual(['Hello World', 'Beam Label']);
    });

    test('empty DXF returns zero entities', async () => {
      const { parseDxf } = await import('../../../dist/agent-langgraph/file-tools.js');
      const result = parseDxf('');
      expect(result.entityCount).toBe(0);
      expect(result.lines).toEqual([]);
      expect(result.texts).toEqual([]);
    });
  });
});

describe('createAnalyzeFileTool', () => {
  let tmpDir;
  let uploadsDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sclaw-file-tools-'));
    uploadsDir = path.join(tmpDir, '.uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('analyzes a CSV file', async () => {
    const { createAnalyzeFileTool } = await import('../../../dist/agent-langgraph/file-tools.js');
    const csvPath = path.join(uploadsDir, 'data.csv');
    await fs.writeFile(csvPath, 'name,value\nA,1\nB,2\n', 'utf8');
    const tool = createAnalyzeFileTool();
    const raw = await tool.invoke(
      { filePath: csvPath },
      { configurable: { workspaceRoot: tmpDir } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe('csv');
    expect(result.headers).toEqual(['name', 'value']);
    expect(result.rows).toEqual([['A', '1'], ['B', '2']]);
  });

  test('analyzes a plain text file', async () => {
    const { createAnalyzeFileTool } = await import('../../../dist/agent-langgraph/file-tools.js');
    const txtPath = path.join(uploadsDir, 'notes.txt');
    await fs.writeFile(txtPath, 'Hello structural engineering', 'utf8');
    const tool = createAnalyzeFileTool();
    const raw = await tool.invoke(
      { filePath: txtPath },
      { configurable: { workspaceRoot: tmpDir } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe('text');
    expect(result.content).toContain('Hello structural engineering');
  });

  test('omits image base64 from analyze_file tool output', async () => {
    const { createAnalyzeFileTool, analyzeUploadedFile } = await import('../../../dist/agent-langgraph/file-tools.js');
    const pngPath = path.join(uploadsDir, 'sketch.png');
    await fs.writeFile(
      pngPath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ6pYQAAAABJRU5ErkJggg==', 'base64'),
    );
    const tool = createAnalyzeFileTool();
    const raw = await tool.invoke(
      { filePath: pngPath },
      { configurable: { workspaceRoot: tmpDir } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe('image');
    expect(result.base64DataUri).toBeUndefined();

    const internal = await analyzeUploadedFile(pngPath, tmpDir, undefined, { includeImageData: true });
    expect(internal.base64DataUri).toMatch(/^data:image\/png;base64,/);
  });

  test('keeps DXF analysis note neutral for structure routing', async () => {
    const { createAnalyzeFileTool } = await import('../../../dist/agent-langgraph/file-tools.js');
    const dxfPath = path.join(uploadsDir, 'drawing.dxf');
    await fs.writeFile(dxfPath, [
      '0', 'LINE',
      '10', '0', '20', '0',
      '11', '6', '21', '0',
      '0', 'TEXT',
      '1', 'Total: 6m',
      '0', 'EOF',
    ].join('\n'), 'utf8');
    const tool = createAnalyzeFileTool();
    const raw = await tool.invoke(
      { filePath: dxfPath },
      { configurable: { workspaceRoot: tmpDir } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(result.type).toBe('dxf');
    expect(result.note.toLowerCase()).not.toMatch(/\b(beams?|columns?)\b/);
  });

  test('rejects path traversal', async () => {
    const { createAnalyzeFileTool } = await import('../../../dist/agent-langgraph/file-tools.js');
    const tool = createAnalyzeFileTool();
    const raw = await tool.invoke(
      { filePath: '../../etc/passwd' },
      { configurable: { workspaceRoot: tmpDir } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/traversal|denied/);
  });

  test('returns FILE_NOT_FOUND for missing file', async () => {
    const { createAnalyzeFileTool } = await import('../../../dist/agent-langgraph/file-tools.js');
    const tool = createAnalyzeFileTool();
    const raw = await tool.invoke(
      { filePath: path.join(uploadsDir, 'missing.csv') },
      { configurable: { workspaceRoot: tmpDir } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toBe('FILE_NOT_FOUND');
  });
});
