import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('attachment context', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sclaw-attachment-context-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('embeds uploaded images as multimodal image_url blocks', async () => {
    const { buildInitialHumanMessageContent } = await import('../../../dist/agent-langgraph/agent-service.js');
    const pngPath = path.join(tmpDir, 'beam-sketch.png');
    await fs.writeFile(
      pngPath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ6pYQAAAABJRU5ErkJggg==', 'base64'),
    );

    const content = await buildInitialHumanMessageContent(
      'Analyze the attached beam sketch.',
      [{
        fileId: 'img-1',
        originalName: 'beam-sketch.png',
        relPath: pngPath,
        mimeType: 'image/png',
      }],
      'en',
      tmpDir,
    );

    expect(Array.isArray(content)).toBe(true);
    const blocks = content;
    expect(blocks.some((block) => block.type === 'text' && block.text.includes('beam-sketch.png'))).toBe(true);
    expect(blocks.some((block) => block.type === 'image_url' && block.image_url.url.startsWith('data:image/png;base64,'))).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain('base64DataUri');
  });

  test('embeds DXF structural hints as text context', async () => {
    const { buildInitialHumanMessageContent } = await import('../../../dist/agent-langgraph/agent-service.js');
    const dxfPath = path.join(tmpDir, 'beam.dxf');
    const dxf = [
      '0', 'LINE',
      '10', '0', '20', '0',
      '11', '6000', '21', '0',
      '0', 'TEXT',
      '1', 'SPAN 6m',
      '0', 'EOF',
    ].join('\n');
    await fs.writeFile(dxfPath, dxf, 'utf8');

    const content = await buildInitialHumanMessageContent(
      'Analyze the attached DXF.',
      [{
        fileId: 'dxf-1',
        originalName: 'beam.dxf',
        relPath: dxfPath,
        mimeType: 'application/dxf',
      }],
      'en',
      tmpDir,
    );

    expect(Array.isArray(content)).toBe(true);
    const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    expect(text).toContain('"type": "dxf"');
    expect(text).toContain('"lineCount": 1');
    expect(text).toContain('SPAN 6m');
  });
});
