import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

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

// Stream 2: file output (always, when path is available)
if (logFilePath) {
  const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  fileStream.on('error', () => {
    // Silently ignore write errors — logging must never crash the app
  });
  streams.push({
    level: config.logLevel as pino.Level,
    stream: fileStream,
  });
}

export const logger = streams.length > 1
  ? pino({ level: config.logLevel }, pino.multistream(streams))
  : pino({ level: config.logLevel });
