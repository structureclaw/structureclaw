import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import process from 'process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { readSettingsFile, migrateLegacyLlmSettings } from './settings-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect installed-package mode: dist/backend/config/index.js -> dist/frontend exists
const isInstalledPackage = existsSync(path.resolve(__dirname, '../../frontend'));

function getUserDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'structureclaw');
  }
  return path.join(os.homedir(), '.structureclaw');
}

const runtimeBaseDir = process.env.SCLAW_DATA_DIR
  || (isInstalledPackage ? getUserDataDir() : path.resolve(__dirname, '../../../.runtime'));

const rootEnvPath = isInstalledPackage
  ? path.join(runtimeBaseDir, '.env')
  : path.resolve(__dirname, '../../../.env');

// Load .env as fallback (advanced users can still use it)
dotenv.config({ path: rootEnvPath });

// Migrate legacy llm-settings.json → settings.json if needed
migrateLegacyLlmSettings();

// Load unified settings file (takes precedence over .env)
const fileSettings = readSettingsFile();

const defaultSqliteDatabasePath = path.join(runtimeBaseDir, 'data', 'structureclaw.db');
const defaultSqliteDatabaseUrl = `file:${defaultSqliteDatabasePath}`;
const defaultUploadDir = runtimeBaseDir;
const defaultLlmSettingsPath = path.join(runtimeBaseDir, 'llm-settings.json');

function resolveReportsDir(rawValue: string | undefined): string {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return path.join(defaultUploadDir, 'reports');
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  return path.resolve(__dirname, '../../../', trimmed);
}

const llmApiKey = fileSettings?.llm?.apiKey
  ?? process.env.LLM_API_KEY
  ?? '';
const llmModel = fileSettings?.llm?.model
  ?? (process.env.LLM_MODEL || undefined)
  ?? 'gpt-4-turbo-preview';
const llmBaseUrl = fileSettings?.llm?.baseUrl
  ?? (process.env.LLM_BASE_URL || undefined)
  ?? 'https://api.openai.com/v1';
const frontendPort = process.env.FRONTEND_PORT || '30000';
const backendPort = fileSettings?.server?.port
  ?? parseInt(process.env.PORT || '8000', 10);
const analysisEngineManifestPath = process.env.ANALYSIS_ENGINE_MANIFEST_PATH || path.join(runtimeBaseDir, 'analysis-engines.json');
const defaultAnalysisPythonBin = process.platform === 'win32'
  ? path.resolve(__dirname, '../../.venv/Scripts/python.exe')
  : path.resolve(__dirname, '../../.venv/bin/python');

const defaultCorsOrigins = [
  `http://localhost:${frontendPort}`,
  `http://127.0.0.1:${frontendPort}`,
  `http://localhost:${backendPort}`,
  `http://127.0.0.1:${backendPort}`,
];

const corsOrigins = (process.env.CORS_ORIGINS || defaultCorsOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export { runtimeBaseDir };

export const config = {
  // 服务配置
  port: typeof backendPort === 'number' ? backendPort : parseInt(String(backendPort), 10),
  host: fileSettings?.server?.host ?? (process.env.HOST || '0.0.0.0'),
  nodeEnv: process.env.NODE_ENV || 'development',
  bodyLimitMb: parseInt(process.env.BACKEND_BODY_LIMIT_MB || '20', 10),

  // 数据库配置
  databaseUrl: fileSettings?.database?.url ?? (process.env.DATABASE_URL || defaultSqliteDatabaseUrl),

  // AI 配置
  llmApiKey,
  llmModel,
  llmBaseUrl,
  llmTimeoutMs: fileSettings?.llm?.timeoutMs
    ?? parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10),
  llmMaxRetries: fileSettings?.llm?.maxRetries
    ?? parseInt(process.env.LLM_MAX_RETRIES || '0', 10),

  // 分析执行配置
  analysisPythonBin: fileSettings?.analysis?.pythonBin
    ?? (process.env.ANALYSIS_PYTHON_BIN || defaultAnalysisPythonBin),
  analysisPythonTimeoutMs: fileSettings?.analysis?.pythonTimeoutMs
    ?? parseInt(process.env.ANALYSIS_PYTHON_TIMEOUT_MS || '600000', 10),
  analysisEngineManifestPath,

  // CORS
  corsOrigins,

  // 文件存储
  reportsDir: resolveReportsDir(process.env.REPORTS_DIR),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10),

  // 日志级别
  logLevel: fileSettings?.logging?.level ?? (process.env.LOG_LEVEL || 'info'),
  /** 应用日志文件路径；默认 <runtimeBaseDir>/logs/app.log */
  logFile: process.env.LOG_FILE || path.join(runtimeBaseDir, 'logs', 'app.log'),

  // LLM 调用日志（默认关闭，设置 LLM_LOG_ENABLED=true 开启）
  llmLogEnabled: fileSettings?.logging?.llmLogEnabled
    ?? (process.env.LLM_LOG_ENABLED === 'true'),
  llmLogDir: process.env.LLM_LOG_DIR || path.join(runtimeBaseDir, 'logs'),
  llmSettingsPath: process.env.LLM_SETTINGS_PATH || defaultLlmSettingsPath,
};

export type Config = typeof config;
