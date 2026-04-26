import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';

export interface RotationOptions {
  /** Max file size in bytes before rotation (default 100MB) */
  maxSize: number;
  /** Max age in days for old log files (default 7) */
  maxAgeDays: number;
}

/**
 * Create a writable stream that rotates the log file when it exceeds maxSize.
 * Old files are renamed with a timestamp suffix and purged after maxAgeDays.
 *
 * Graceful degradation: if rotation fails, the stream continues writing to
 * the current file. Write errors are silently ignored — logging must never
 * crash the application.
 */
export function createRotatingFileStream(
  filePath: string,
  opts: RotationOptions,
): Writable {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  // Ensure directory exists
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory may already exist from a sibling stream
  }

  let currentStream = fs.createWriteStream(filePath, { flags: 'a' });
  currentStream.on('error', () => {});

  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
      tryRotate();
      if (currentStream.destroyed) {
        // Reopen if the underlying stream was destroyed
        currentStream = fs.createWriteStream(filePath, { flags: 'a' });
        currentStream.on('error', () => {});
      }
      currentStream.write(chunk, callback);
    },
    destroy(error: Error | null, callback: (error?: Error | null) => void) {
      currentStream.end(() => callback(error));
    },
  });

  return stream;

  /**
   * Check file size and rotate if needed. Non-blocking on failure.
   */
  function tryRotate(): void {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < opts.maxSize) return;

      // Rename current file with timestamp suffix
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedName = `${base}.${timestamp}`;
      const rotatedPath = path.join(dir, rotatedName);
      fs.renameSync(filePath, rotatedPath);

      // Open a fresh stream for new writes
      currentStream.end();
      currentStream = fs.createWriteStream(filePath, { flags: 'a' });
      currentStream.on('error', () => {});

      // Purge old files
      purgeOldFiles();
    } catch {
      // Rotation failed — continue writing to current file
    }
  }

  /**
   * Remove rotated log files older than maxAgeDays.
   */
  function purgeOldFiles(): void {
    try {
      const files = fs.readdirSync(dir);
      const prefix = `${base}.`;
      const cutoff = Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.startsWith(prefix)) continue;
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(fullPath);
          }
        } catch {
          // File may have been removed by a concurrent process
        }
      }
    } catch {
      // Purge failure must not affect logging
    }
  }
}
