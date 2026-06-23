import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

jest.setTimeout(20000);

describe('attachment context', () => {
  let tmpDir;
  let previousEnv;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sclaw-attachment-context-'));
    previousEnv = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_VISION_API_KEY: process.env.LLM_VISION_API_KEY,
      LLM_VISION_MODEL: process.env.LLM_VISION_MODEL,
      LLM_VISION_BASE_URL: process.env.LLM_VISION_BASE_URL,
    };
    process.env.SCLAW_DATA_DIR = tmpDir;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_VISION_API_KEY;
    delete process.env.LLM_VISION_MODEL;
    delete process.env.LLM_VISION_BASE_URL;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('keeps uploaded image binaries out of the main agent message', async () => {
    const { buildInitialHumanMessagePayload } = await import('../../../dist/agent-langgraph/agent-service.js');
    const pngPath = path.join(tmpDir, 'beam-sketch.png');
    await fs.writeFile(
      pngPath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ6pYQAAAABJRU5ErkJggg==', 'base64'),
    );

    const payload = await buildInitialHumanMessagePayload(
      'Analyze the attached beam sketch.',
      [{
        fileId: 'img-1',
        originalName: 'beam-sketch.png',
        relPath: pngPath,
        mimeType: 'image/png',
      }],
      'en',
      tmpDir,
      { summarizeImages: true },
    );

    expect(typeof payload.content).toBe('string');
    expect(payload.content).toContain('beam-sketch.png');
    expect(payload.content).toContain('vision summary unavailable');
    expect(payload.content).not.toContain('image_url');
    expect(payload.content).not.toContain('base64DataUri');
    expect(payload.content).not.toContain('data:image/png;base64');
  });

  test('preserves large image notes and asks for missing vision details', async () => {
    const { buildInitialHumanMessagePayload } = await import('../../../dist/agent-langgraph/agent-service.js');
    const pngPath = path.join(tmpDir, 'large-frame-sketch.png');
    await fs.writeFile(pngPath, Buffer.alloc(4 * 1024 * 1024 + 1, 1));

    const payload = await buildInitialHumanMessagePayload(
      'Analyze the attached large frame sketch.',
      [{
        fileId: 'img-large',
        originalName: 'large-frame-sketch.png',
        relPath: pngPath,
        mimeType: 'image/png',
      }],
      'en',
      tmpDir,
      { summarizeImages: true },
    );

    expect(typeof payload.content).toBe('string');
    expect(payload.content).toContain('Image too large for base64 encoding');
    expect(payload.content).toContain('vision summary unavailable');
    expect(payload.content).not.toContain('Image binary is parsed only by the configured vision model');
    expect(payload.content).not.toContain('base64DataUri');
    expect(payload.content).not.toContain('data:image/png;base64');
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

    expect(typeof content).toBe('string');
    const text = content;
    expect(text).toContain('"type": "dxf"');
    expect(text).toContain('"lineCount": 1');
    expect(text).toContain('SPAN 6m');
  });
});
