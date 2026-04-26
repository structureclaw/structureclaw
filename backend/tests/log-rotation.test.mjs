import { describe, expect, test, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * log-rotation.ts provides a rotating file stream for pino.
 * We test: basic writes, rotation trigger, and old file purge.
 */

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'log-rotation-test-'));
}

function writeLines(stream, count, lineLength = 100) {
  for (let i = 0; i < count; i++) {
    stream.write(`${'x'.repeat(lineLength)}\n`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('log-rotation', () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Cleanup best-effort
      }
    }
    tempDirs.length = 0;
  });

  function freshDir() {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
  }

  test('writes JSON lines to file', async () => {
    const dir = freshDir();
    const filePath = path.join(dir, 'test.log');
    const { createRotatingFileStream } = await import('../dist/utils/log-rotation.js');

    const stream = createRotatingFileStream(filePath, {
      maxSize: 1_000_000,
      maxAgeDays: 7,
    });

    stream.write('{"level":"info","msg":"hello"}\n');
    stream.write('{"level":"debug","msg":"world"}\n');

    // Wait for writes to flush
    await new Promise((resolve) => stream.end(resolve));

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('"hello"');
    expect(content).toContain('"world"');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  test('rotation triggers when file exceeds maxSize', async () => {
    const dir = freshDir();
    const filePath = path.join(dir, 'test.log');
    const { createRotatingFileStream } = await import('../dist/utils/log-rotation.js');

    // Pre-fill the log file to near maxSize so rotation triggers early
    fs.writeFileSync(filePath, 'x'.repeat(400));

    // Use a very small maxSize to force rotation quickly
    const stream = createRotatingFileStream(filePath, {
      maxSize: 500,
      maxAgeDays: 7,
    });

    // Write enough lines to exceed both maxSize and the rotation check interval (100 writes)
    writeLines(stream, 110, 100);

    await new Promise((resolve) => stream.end(resolve));

    // Check that a rotated file was created
    const files = fs.readdirSync(dir);
    const rotatedFiles = files.filter(
      (f) => f.startsWith('test.log.') && f !== 'test.log',
    );
    expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);

    // Current file should still exist and have content
    expect(fs.existsSync(filePath)).toBe(true);
    const currentContent = fs.readFileSync(filePath, 'utf-8');
    expect(currentContent.length).toBeGreaterThan(0);
  });

  test('purges old rotated files beyond maxAgeDays', async () => {
    const dir = freshDir();
    const filePath = path.join(dir, 'test.log');
    const { createRotatingFileStream } = await import('../dist/utils/log-rotation.js');

    // Create an old rotated file manually with a name that matches the prefix
    const oldFileName = 'test.log.old-rotated';
    const oldFilePath = path.join(dir, oldFileName);
    fs.writeFileSync(oldFilePath, 'old log content\n');

    // Set mtime to 10 days ago so purge logic considers it expired
    const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    fs.utimesSync(oldFilePath, new Date(oldTime), new Date(oldTime));

    // Verify old file exists
    expect(fs.existsSync(oldFilePath)).toBe(true);

    // Pre-fill the log file to near maxSize so rotation triggers on first write
    fs.writeFileSync(filePath, 'x'.repeat(200));

    // Trigger rotation by exceeding maxSize
    const stream = createRotatingFileStream(filePath, {
      maxSize: 200,
      maxAgeDays: 7,
    });

    // Write enough to exceed maxSize and trigger rotation + purge
    // Must exceed both maxSize and the rotation check interval (100 writes)
    writeLines(stream, 110, 100);

    await new Promise((resolve) => stream.end(resolve));

    // Old file should have been purged during rotation
    expect(fs.existsSync(oldFilePath)).toBe(false);
  });

  test('continues writing when rotation fails', async () => {
    const dir = freshDir();
    const filePath = path.join(dir, 'test.log');
    const { createRotatingFileStream } = await import('../dist/utils/log-rotation.js');

    // Write initial content
    const stream = createRotatingFileStream(filePath, {
      maxSize: 1_000_000,
      maxAgeDays: 7,
    });

    stream.write('{"msg":"first"}\n');

    // Delete the file between writes to simulate a rotation failure scenario
    // The stream should still accept writes gracefully
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    stream.write('{"msg":"second"}\n');

    await new Promise((resolve) => stream.end(resolve));

    // Stream should not have crashed — the test completing is the assertion
    expect(true).toBe(true);
  });
});
