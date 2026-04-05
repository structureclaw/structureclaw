import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from './logger.js';

interface LlmLogEntry {
  timestamp: string;
  model: string;
  prompt: string;
  response: string | null;
  promptChars: number;
  responseChars: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

class LlmCallLogger {
  private stream: fs.WriteStream | null = null;
  private initialised = false;
  private disabled = false;
  private warnedOnce = false;

  /**
   * Serialised write queue.
   * On Windows, calling stream.write() in a tight loop can leave entries in
   * the kernel buffer long after the call returns, causing reads that follow
   * a fixed setTimeout to see fewer lines than expected.  Chaining every
   * write as a Promise that waits for the 'drain' event when backpressure is
   * signalled ensures all bytes are handed to the OS before the Promise
   * resolves, so rapid-sequential tests are reliable on all platforms.
   */
  private writeQueue: Promise<void> = Promise.resolve();

  private ensureStream(): fs.WriteStream | null {
    if (this.disabled) return null;
    if (this.stream) return this.stream;
    if (this.initialised) return null;

    this.initialised = true;

    if (!config.llmLogEnabled) {
      this.disabled = true;
      return null;
    }

    try {
      const dir = config.llmLogDir
        || path.resolve(process.cwd(), '../.runtime/logs');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'llm-calls.jsonl');
      this.stream = fs.createWriteStream(filePath, { flags: 'a' });
      this.stream.on('error', (err) => {
        if (!this.warnedOnce) {
          this.warnedOnce = true;
          logger.warn({ err }, 'LLM call log write stream error');
        }
      });
      return this.stream;
    } catch (err) {
      if (!this.warnedOnce) {
        this.warnedOnce = true;
        logger.warn({ err }, 'Failed to initialise LLM call log file');
      }
      this.disabled = true;
      return null;
    }
  }

  log(entry: Omit<LlmLogEntry, 'timestamp' | 'promptChars' | 'responseChars'>): void {
    const stream = this.ensureStream();
    if (!stream) return;

    const full: LlmLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      promptChars: entry.prompt.length,
      responseChars: entry.response?.length ?? 0,
    };

    const line = JSON.stringify(full) + '\n';

    // Chain onto the existing queue so writes are strictly sequential and
    // backpressure (drain) is respected.  This prevents the Windows-specific
    // race where buffered writes are not yet visible to a subsequent read.
    this.writeQueue = this.writeQueue.then(
      () =>
        new Promise<void>((resolve) => {
          try {
            const ok = stream.write(line);
            if (ok) {
              resolve();
            } else {
              stream.once('drain', resolve);
            }
          } catch {
            // Non-blocking: never crash on log write failure.
            resolve();
          }
        }),
    );
  }
}

export const llmCallLogger = new LlmCallLogger();
