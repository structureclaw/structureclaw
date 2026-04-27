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
const frontendPort = fileSettings?.server?.frontendPort?.toString()
  ?? (process.env.FRONTEND_PORT || '30000');
const backendPort = fileSettings?.server?.port
  ?? parseInt(process.env.PORT || '8000', 10);
const analysisEngineManifestPath = fileSettings?.analysis?.engineManifestPath
  ?? (process.env.ANALYSIS_ENGINE_MANIFEST_PATH || path.join(runtimeBaseDir, 'analysis-engines.json'));
const defaultAnalysisPythonBin = isInstalledPackage
  ? (process.platform === 'win32'
    ? path.join(runtimeBaseDir, '.venv', 'Scripts', 'python.exe')
    : path.join(runtimeBaseDir, '.venv', 'bin', 'python'))
  : (process.platform === 'win32'
    ? path.resolve(__dirname, '../../.venv/Scripts/python.exe')
    : path.resolve(__dirname, '../../.venv/bin/python'));

const defaultCorsOrigins = [
  `http://localhost:${frontendPort}`,
  `http://127.0.0.1:${frontendPort}`,
  `http://localhost:${backendPort}`,
  `http://127.0.0.1:${backendPort}`,
];

const corsOrigins = (fileSettings?.cors?.origins ?? (process.env.CORS_ORIGINS || defaultCorsOrigins.join(',')))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export { runtimeBaseDir };

export const config = {
  // 服务配置
  port: typeof backendPort === 'number' ? backendPort : parseInt(String(backendPort), 10),
  host: fileSettings?.server?.host ?? (process.env.HOST || '0.0.0.0'),
  nodeEnv: process.env.NODE_ENV || 'development',
  bodyLimitMb: fileSettings?.server?.bodyLimitMb
    ?? parseInt(process.env.BACKEND_BODY_LIMIT_MB || '20', 10),
  frontendPort: parseInt(frontendPort, 10),

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
  reportsDir: resolveReportsDir(fileSettings?.storage?.reportsDir ?? process.env.REPORTS_DIR),
  maxFileSize: fileSettings?.storage?.maxFileSize
    ?? parseInt(process.env.MAX_FILE_SIZE || '104857600', 10),

  // 日志级别
  logLevel: fileSettings?.logging?.level ?? (process.env.LOG_LEVEL || 'info'),
  /** 应用日志文件路径；默认 <runtimeBaseDir>/logs/app.log */
  logFile: process.env.LOG_FILE || path.join(runtimeBaseDir, 'logs', 'app.log'),
  /** 日志轮换：保留天数（默认 7 天） */
  logMaxAgeDays: fileSettings?.logging?.logMaxAgeDays
    ?? (Math.max(1, parseInt(process.env.LOG_MAX_AGE_DAYS || '7', 10)) || 7),
  /** 日志轮换：单文件最大字节数（默认 100MB） */
  logMaxSize: fileSettings?.logging?.logMaxSize
    ?? (Math.max(1, parseInt(process.env.LOG_MAX_SIZE || '104857600', 10)) || 104857600),

  // LLM 调用日志（默认关闭，设置 LLM_LOG_ENABLED=true 开启）
  llmLogEnabled: fileSettings?.logging?.llmLogEnabled
    ?? (process.env.LLM_LOG_ENABLED === 'true'),
  llmLogDir: fileSettings?.logging?.llmLogDir
    ?? (process.env.LLM_LOG_DIR || path.join(runtimeBaseDir, 'logs')),
  llmSettingsPath: process.env.LLM_SETTINGS_PATH || defaultLlmSettingsPath,

  // Agent 配置
  agentWorkspaceRoot: fileSettings?.agent?.workspaceRoot
    ?? (process.env.WORKSPACE_ROOT || ''),
  agentCheckpointDir: fileSettings?.agent?.checkpointDir
    ?? (process.env.AGENT_CHECKPOINT_DIR || path.join(runtimeBaseDir, 'agent-checkpoints')),
  agentAllowShell: fileSettings?.agent?.allowShell
    ?? (process.env.AGENT_ALLOW_SHELL === 'true'),
  agentAllowedShell: fileSettings?.agent?.allowedShellCommands
    ?? (process.env.AGENT_ALLOWED_SHELL_COMMANDS || 'node,npm,python,python3,./sclaw,./sclaw_cn'),
  agentShellTimeoutMs: fileSettings?.agent?.shellTimeoutMs
    ?? parseInt(process.env.AGENT_SHELL_TIMEOUT_MS || '300000', 10),

  // PKPM 引擎配置
  pkpmCyclePath: fileSettings?.pkpm?.cyclePath
    ?? (process.env.PKPM_CYCLE_PATH || ''),
  pkpmWorkDir: fileSettings?.pkpm?.workDir
    ?? (process.env.PKPM_WORK_DIR || ''),

  // YJK 引擎配置
  yjkInstallRoot: fileSettings?.yjk?.installRoot
    ?? (process.env.YJK_PATH || process.env.YJKS_ROOT || ''),
  yjkExePath: fileSettings?.yjk?.exePath
    ?? (process.env.YJKS_EXE || ''),
  yjkPythonBin: fileSettings?.yjk?.pythonBin
    ?? (process.env.YJK_PYTHON_BIN || ''),
  yjkWorkDir: fileSettings?.yjk?.workDir
    ?? (process.env.YJK_WORK_DIR || ''),
  yjkVersion: fileSettings?.yjk?.version
    ?? (process.env.YJK_VERSION || '8.0.0'),
  yjkTimeoutS: fileSettings?.yjk?.timeoutS
    ?? parseInt(process.env.YJK_TIMEOUT_S || '600', 10),
  yjkInvisible: fileSettings?.yjk?.invisible
    ?? (process.env.YJK_INVISIBLE === '1'),
};

export type Config = typeof config;
