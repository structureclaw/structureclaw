import type { Logger } from 'pino';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { createRotatingFileStream } from './log-rotation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveLogFilePath(): string | null {
  if (config.logFile) return config.logFile;
  // __dirname = backend/dist/utils/ → repo-root/.runtime/logs/app.log
  const defaultPath = path.resolve(__dirname, '../../../.runtime/logs/app.log');
  try {
    fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
    return defaultPath;
  } catch {
    return null;
  }
}

const logFilePath = resolveLogFilePath();

const streams: pino.StreamEntry[] = [];

// Stream 1: pretty console output (development)
if (config.nodeEnv === 'development') {
  streams.push({
    level: config.logLevel as pino.Level,
    stream: pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }),
  });
}

// Stream 2: rotating file output (always, when path is available)
if (logFilePath) {
  const rotatingStream = createRotatingFileStream(logFilePath, {
    maxSize: config.logMaxSize,
    maxAgeDays: config.logMaxFiles,
  });
  streams.push({
    level: config.logLevel as pino.Level,
    stream: rotatingStream,
  });
}

export const logger: Logger = streams.length > 1
  ? pino({ level: config.logLevel }, pino.multistream(streams))
  : pino({ level: config.logLevel });

/** Create a child logger with extra bound context (e.g. traceId, conversationId). */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
