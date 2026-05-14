/**
 * Unified settings file — reads/writes `~/.structureclaw/settings.json`.
 *
 * All fields are optional; missing values fall back to hardcoded defaults.
 * Extends the same cache/read/write pattern as llm-runtime.ts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeBaseDir } from './index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsFileServer = {
  port?: number;
  host?: string;
  bodyLimitMb?: number;
  frontendPort?: number;
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
  llmLogDir?: string;
};

export type SettingsFileAnalysis = {
  pythonBin?: string;
  pythonTimeoutMs?: number;
  engineManifestPath?: string;
};

export type SettingsFileStorage = {
  reportsDir?: string;
  maxFileSize?: number;
};

export type SettingsFileCors = {
  origins?: string;
};

export type SettingsFileAgent = {
  workspaceRoot?: string;
  checkpointDir?: string;
  allowShell?: boolean;
  allowedShellCommands?: string;
  shellTimeoutMs?: number;
  maxToolCallsPerTurn?: number;
};

export type SettingsFilePkpm = {
  cyclePath?: string;
  workDir?: string;
};

export type SettingsFileYjk = {
  installRoot?: string;
  exePath?: string;
  pythonBin?: string;
  sdkArchivePath?: string;
  workDir?: string;
  version?: string;
  timeoutS?: number;
  invisible?: boolean;
  launcherPrewarm?: string;
  launcherPrewarmS?: number;
  directReadyTimeoutS?: number;
};

export type SettingsFile = {
  server?: SettingsFileServer;
  llm?: SettingsFileLlm;
  database?: SettingsFileDatabase;
  logging?: SettingsFileLogging;
  analysis?: SettingsFileAnalysis;
  storage?: SettingsFileStorage;
  cors?: SettingsFileCors;
  agent?: SettingsFileAgent;
  pkpm?: SettingsFilePkpm;
  yjk?: SettingsFileYjk;
  updatedAt?: string;
};

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getSettingsFilePath(): string {
  // Allow runtime override for testing
  const overrideDir = process.env.SCLAW_DATA_DIR;
  const baseDir = overrideDir || runtimeBaseDir;
  return path.join(baseDir, 'settings.json');
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function normalizeOptionalString(value: unknown): string | undefined {
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

function normalizeYjkLauncherPrewarm(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (['0', 'false', 'no', 'off', 'never', 'disabled'].includes(normalized)) return 'off';
  if (['1', 'true', 'yes', 'on', 'always', 'force'].includes(normalized)) return 'always';
  return 'auto';
}

function normalizeServerSection(raw: unknown): SettingsFileServer | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const port = normalizeOptionalNumber(record.port);
  const host = normalizeOptionalString(record.host);
  const bodyLimitMb = normalizeOptionalNumber(record.bodyLimitMb);
  const frontendPort = normalizeOptionalNumber(record.frontendPort);
  if (port === undefined && host === undefined && bodyLimitMb === undefined && frontendPort === undefined) return undefined;
  const result: SettingsFileServer = {};
  if (port !== undefined) result.port = port;
  if (host !== undefined) result.host = host;
  if (bodyLimitMb !== undefined) result.bodyLimitMb = bodyLimitMb;
  if (frontendPort !== undefined) result.frontendPort = frontendPort;
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
  const llmLogDir = normalizeOptionalString(record.llmLogDir);
  if (level === undefined && llmLogEnabled === undefined && logMaxAgeDays === undefined && logMaxSize === undefined && llmLogDir === undefined) return undefined;
  const result: SettingsFileLogging = {};
  if (level !== undefined) result.level = level;
  if (llmLogEnabled !== undefined) result.llmLogEnabled = llmLogEnabled;
  if (logMaxAgeDays !== undefined) result.logMaxAgeDays = logMaxAgeDays;
  if (logMaxSize !== undefined) result.logMaxSize = logMaxSize;
  if (llmLogDir !== undefined) result.llmLogDir = llmLogDir;
  return result;
}

function normalizeAnalysisSection(raw: unknown): SettingsFileAnalysis | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const pythonBin = normalizeOptionalString(record.pythonBin);
  const pythonTimeoutMs = normalizeOptionalNumber(record.pythonTimeoutMs);
  const engineManifestPath = normalizeOptionalString(record.engineManifestPath);
  if (pythonBin === undefined && pythonTimeoutMs === undefined && engineManifestPath === undefined) return undefined;
  const result: SettingsFileAnalysis = {};
  if (pythonBin !== undefined) result.pythonBin = pythonBin;
  if (pythonTimeoutMs !== undefined) result.pythonTimeoutMs = pythonTimeoutMs;
  if (engineManifestPath !== undefined) result.engineManifestPath = engineManifestPath;
  return result;
}

function normalizeStorageSection(raw: unknown): SettingsFileStorage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const reportsDir = normalizeOptionalString(record.reportsDir);
  const maxFileSize = normalizeOptionalNumber(record.maxFileSize);
  if (reportsDir === undefined && maxFileSize === undefined) return undefined;
  const result: SettingsFileStorage = {};
  if (reportsDir !== undefined) result.reportsDir = reportsDir;
  if (maxFileSize !== undefined) result.maxFileSize = maxFileSize;
  return result;
}

function normalizeCorsSection(raw: unknown): SettingsFileCors | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const origins = normalizeOptionalString(record.origins);
  if (origins === undefined) return undefined;
  return { origins };
}

function normalizeAgentSection(raw: unknown): SettingsFileAgent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const workspaceRoot = normalizeOptionalString(record.workspaceRoot);
  const checkpointDir = normalizeOptionalString(record.checkpointDir);
  const allowShell = normalizeOptionalBoolean(record.allowShell);
  const allowedShellCommands = normalizeOptionalString(record.allowedShellCommands);
  const shellTimeoutMs = normalizeOptionalNumber(record.shellTimeoutMs);
  const maxToolCallsPerTurn = normalizeOptionalNumber(record.maxToolCallsPerTurn);
  if (workspaceRoot === undefined && checkpointDir === undefined && allowShell === undefined && allowedShellCommands === undefined && shellTimeoutMs === undefined && maxToolCallsPerTurn === undefined) return undefined;
  const result: SettingsFileAgent = {};
  if (workspaceRoot !== undefined) result.workspaceRoot = workspaceRoot;
  if (checkpointDir !== undefined) result.checkpointDir = checkpointDir;
  if (allowShell !== undefined) result.allowShell = allowShell;
  if (allowedShellCommands !== undefined) result.allowedShellCommands = allowedShellCommands;
  if (shellTimeoutMs !== undefined) result.shellTimeoutMs = shellTimeoutMs;
  if (maxToolCallsPerTurn !== undefined) result.maxToolCallsPerTurn = maxToolCallsPerTurn;
  return result;
}

function normalizePkpmSection(raw: unknown): SettingsFilePkpm | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const cyclePath = normalizeOptionalString(record.cyclePath);
  const workDir = normalizeOptionalString(record.workDir);
  if (cyclePath === undefined && workDir === undefined) return undefined;
  const result: SettingsFilePkpm = {};
  if (cyclePath !== undefined) result.cyclePath = cyclePath;
  if (workDir !== undefined) result.workDir = workDir;
  return result;
}

function normalizeYjkSection(raw: unknown): SettingsFileYjk | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const installRoot = normalizeOptionalString(record.installRoot);
  const exePath = normalizeOptionalString(record.exePath);
  const pythonBin = normalizeOptionalString(record.pythonBin);
  const sdkArchivePath = normalizeOptionalString(record.sdkArchivePath);
  const workDir = normalizeOptionalString(record.workDir);
  const version = normalizeOptionalString(record.version);
  const timeoutS = normalizeOptionalNumber(record.timeoutS);
  const invisible = normalizeOptionalBoolean(record.invisible);
  const launcherPrewarm = normalizeYjkLauncherPrewarm(record.launcherPrewarm);
  const launcherPrewarmS = normalizeOptionalNumber(record.launcherPrewarmS);
  const directReadyTimeoutS = normalizeOptionalNumber(record.directReadyTimeoutS);
  if (
    installRoot === undefined
    && exePath === undefined
    && pythonBin === undefined
    && sdkArchivePath === undefined
    && workDir === undefined
    && version === undefined
    && timeoutS === undefined
    && invisible === undefined
    && launcherPrewarm === undefined
    && launcherPrewarmS === undefined
    && directReadyTimeoutS === undefined
  ) return undefined;
  const result: SettingsFileYjk = {};
  if (installRoot !== undefined) result.installRoot = installRoot;
  if (exePath !== undefined) result.exePath = exePath;
  if (pythonBin !== undefined) result.pythonBin = pythonBin;
  if (sdkArchivePath !== undefined) result.sdkArchivePath = sdkArchivePath;
  if (workDir !== undefined) result.workDir = workDir;
  if (version !== undefined) result.version = version;
  if (timeoutS !== undefined) result.timeoutS = timeoutS;
  if (invisible !== undefined) result.invisible = invisible;
  if (launcherPrewarm !== undefined) result.launcherPrewarm = launcherPrewarm;
  if (launcherPrewarmS !== undefined) result.launcherPrewarmS = launcherPrewarmS;
  if (directReadyTimeoutS !== undefined) result.directReadyTimeoutS = directReadyTimeoutS;
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
  const storage = normalizeStorageSection(record.storage);
  const cors = normalizeCorsSection(record.cors);
  const agent = normalizeAgentSection(record.agent);
  const pkpm = normalizePkpmSection(record.pkpm);
  const yjk = normalizeYjkSection(record.yjk);
  const updatedAt = normalizeOptionalString(record.updatedAt);
  if (!server && !llm && !database && !logging && !analysis && !storage && !cors && !agent && !pkpm && !yjk) return null;
  const result: SettingsFile = {};
  if (server) result.server = server;
  if (llm) result.llm = llm;
  if (database) result.database = database;
  if (logging) result.logging = logging;
  if (analysis) result.analysis = analysis;
  if (storage) result.storage = storage;
  if (cors) result.cors = cors;
  if (agent) result.agent = agent;
  if (pkpm) result.pkpm = pkpm;
  if (yjk) result.yjk = yjk;
  if (updatedAt) result.updatedAt = updatedAt;
  return result;
}

// ---------------------------------------------------------------------------
// Disk I/O with cache
// ---------------------------------------------------------------------------

let cachedSettings: SettingsFile | null | undefined;
let cachedSettingsPath: string | undefined;
type SettingsFileFingerprint = {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  sha256: string;
};

let cachedSettingsFingerprint: SettingsFileFingerprint | null | undefined;

function getSettingsFileFingerprint(filePath: string): SettingsFileFingerprint | null {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath);
    return {
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  } catch {
    return null;
  }
}

function isSameFingerprint(
  left: SettingsFileFingerprint | null | undefined,
  right: SettingsFileFingerprint | null,
): boolean {
  if (left === undefined) return false;
  if (left === null || right === null) return left === right;
  return left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function setCache(
  filePath: string,
  settings: SettingsFile | null,
  fingerprint: SettingsFileFingerprint | null = getSettingsFileFingerprint(filePath),
): void {
  cachedSettingsPath = filePath;
  cachedSettings = settings;
  cachedSettingsFingerprint = fingerprint;
}

function readSettingsFromDisk(filePath: string): SettingsFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeSettingsFile(raw);
  } catch {
    return null;
  }
}

export function readSettingsFile(): SettingsFile | null {
  const filePath = getSettingsFilePath();
  const currentFingerprint = getSettingsFileFingerprint(filePath);
  if (
    cachedSettingsPath === filePath
    && cachedSettings !== undefined
    && isSameFingerprint(cachedSettingsFingerprint, currentFingerprint)
  ) {
    return cachedSettings;
  }
  const settings = readSettingsFromDisk(filePath);
  setCache(filePath, settings, currentFingerprint);
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
