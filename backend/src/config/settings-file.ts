/**
 * Unified settings file — reads/writes `~/.structureclaw/settings.json`.
 *
 * All fields are optional; missing values fall back to .env / hardcoded defaults.
 * Extends the same cache/read/write pattern as llm-runtime.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runtimeBaseDir } from './index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsFileServer = {
  port?: number;
  host?: string;
};

export type SettingsFileLlm = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type SettingsFileDatabase = {
  url?: string;
};

export type SettingsFileLogging = {
  level?: string;
  llmLogEnabled?: boolean;
  logMaxAgeDays?: number;
  logMaxSize?: number;
};

export type SettingsFileAnalysis = {
  pythonBin?: string;
  pythonTimeoutMs?: number;
};

export type SettingsFile = {
  server?: SettingsFileServer;
  llm?: SettingsFileLlm;
  database?: SettingsFileDatabase;
  logging?: SettingsFileLogging;
  analysis?: SettingsFileAnalysis;
  updatedAt?: string;
};

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function getSettingsFilePath(): string {
  // Allow runtime override for testing
  const overrideDir = process.env.SCLAW_DATA_DIR;
  const baseDir = overrideDir || runtimeBaseDir;
  return path.join(baseDir, 'settings.json');
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

function normalizeServerSection(raw: unknown): SettingsFileServer | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const port = normalizeOptionalNumber(record.port);
  const host = normalizeOptionalString(record.host);
  if (port === undefined && host === undefined) return undefined;
  const result: SettingsFileServer = {};
  if (port !== undefined) result.port = port;
  if (host !== undefined) result.host = host;
  return result;
}

function normalizeLlmSection(raw: unknown): SettingsFileLlm | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const baseUrl = normalizeOptionalString(record.baseUrl);
  const model = normalizeOptionalString(record.model);
  const apiKey = normalizeOptionalString(record.apiKey);
  const timeoutMs = normalizeOptionalNumber(record.timeoutMs);
  const maxRetries = normalizeOptionalNumber(record.maxRetries);
  if (
    baseUrl === undefined && model === undefined && apiKey === undefined
    && timeoutMs === undefined && maxRetries === undefined
  ) return undefined;
  const result: SettingsFileLlm = {};
  if (baseUrl !== undefined) result.baseUrl = baseUrl;
  if (model !== undefined) result.model = model;
  if (apiKey !== undefined) result.apiKey = apiKey;
  if (timeoutMs !== undefined) result.timeoutMs = timeoutMs;
  if (maxRetries !== undefined) result.maxRetries = maxRetries;
  return result;
}

function normalizeDatabaseSection(raw: unknown): SettingsFileDatabase | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const url = normalizeOptionalString(record.url);
  if (url === undefined) return undefined;
  return { url };
}

function normalizeLoggingSection(raw: unknown): SettingsFileLogging | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const level = normalizeOptionalString(record.level);
  const llmLogEnabled = normalizeOptionalBoolean(record.llmLogEnabled);
  const logMaxAgeDays = normalizeOptionalNumber(record.logMaxAgeDays);
  const logMaxSize = normalizeOptionalNumber(record.logMaxSize);
  if (level === undefined && llmLogEnabled === undefined && logMaxAgeDays === undefined && logMaxSize === undefined) return undefined;
  const result: SettingsFileLogging = {};
  if (level !== undefined) result.level = level;
  if (llmLogEnabled !== undefined) result.llmLogEnabled = llmLogEnabled;
  if (logMaxAgeDays !== undefined) result.logMaxAgeDays = logMaxAgeDays;
  if (logMaxSize !== undefined) result.logMaxSize = logMaxSize;
  return result;
}

function normalizeAnalysisSection(raw: unknown): SettingsFileAnalysis | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const pythonBin = normalizeOptionalString(record.pythonBin);
  const pythonTimeoutMs = normalizeOptionalNumber(record.pythonTimeoutMs);
  if (pythonBin === undefined && pythonTimeoutMs === undefined) return undefined;
  const result: SettingsFileAnalysis = {};
  if (pythonBin !== undefined) result.pythonBin = pythonBin;
  if (pythonTimeoutMs !== undefined) result.pythonTimeoutMs = pythonTimeoutMs;
  return result;
}

function normalizeSettingsFile(raw: unknown): SettingsFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const server = normalizeServerSection(record.server);
  const llm = normalizeLlmSection(record.llm);
  const database = normalizeDatabaseSection(record.database);
  const logging = normalizeLoggingSection(record.logging);
  const analysis = normalizeAnalysisSection(record.analysis);
  const updatedAt = normalizeOptionalString(record.updatedAt);
  if (!server && !llm && !database && !logging && !analysis) return null;
  const result: SettingsFile = {};
  if (server) result.server = server;
  if (llm) result.llm = llm;
  if (database) result.database = database;
  if (logging) result.logging = logging;
  if (analysis) result.analysis = analysis;
  if (updatedAt) result.updatedAt = updatedAt;
  return result;
}

// ---------------------------------------------------------------------------
// Disk I/O with cache
// ---------------------------------------------------------------------------

let cachedSettings: SettingsFile | null | undefined;
let cachedSettingsPath: string | undefined;

function setCache(filePath: string, settings: SettingsFile | null): void {
  cachedSettingsPath = filePath;
  cachedSettings = settings;
}

export function invalidateSettingsCache(): void {
  cachedSettingsPath = undefined;
  cachedSettings = undefined;
  // Also clear path cache so SCLAW_DATA_DIR changes are picked up
  cachedSettingsPath = undefined;
}

function readSettingsFromDisk(): SettingsFile | null {
  const filePath = getSettingsFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeSettingsFile(raw);
  } catch {
    return null;
  }
}

export function readSettingsFile(): SettingsFile | null {
  const filePath = getSettingsFilePath();
  if (cachedSettingsPath === filePath && cachedSettings !== undefined) {
    return cachedSettings;
  }
  const settings = readSettingsFromDisk();
  setCache(filePath, settings);
  return settings;
}

export function writeSettingsFile(settings: SettingsFile): void {
  const filePath = getSettingsFilePath();
  const normalized = normalizeSettingsFile(settings);
  if (!normalized) {
    // All fields cleared — delete file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    setCache(filePath, null);
    return;
  }
  const toWrite: SettingsFile = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(toWrite, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  setCache(filePath, toWrite);
}

// ---------------------------------------------------------------------------
// Legacy llm-settings.json migration
// ---------------------------------------------------------------------------

export function migrateLegacyLlmSettings(): void {
  const settingsPath = getSettingsFilePath();
  const legacyPath = path.join(runtimeBaseDir, 'llm-settings.json');

  // Skip if settings.json already exists or legacy file is missing
  if (fs.existsSync(settingsPath) || !fs.existsSync(legacyPath)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    const llm = normalizeLlmSection(raw);
    if (!llm) return;

    writeSettingsFile({ llm });
    fs.unlinkSync(legacyPath);
  } catch {
    // Non-fatal: leave legacy file in place
  }
}
