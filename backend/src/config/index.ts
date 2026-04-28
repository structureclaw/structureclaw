import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { readSettingsFile, migrateLegacyLlmSettings } from './settings-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getUserDataDir(): string {
  return path.join(os.homedir(), '.structureclaw');
}

const runtimeBaseDir = process.env.SCLAW_DATA_DIR || getUserDataDir();

// Migrate legacy llm-settings.json → settings.json if needed
migrateLegacyLlmSettings();

// Load unified settings file (single source of user-facing truth)
const fileSettings = readSettingsFile();

const defaultSqliteDatabasePath = path.join(runtimeBaseDir, 'data', 'structureclaw.db');
const defaultSqliteDatabaseUrl = `file:${defaultSqliteDatabasePath}`;
const defaultUploadDir = runtimeBaseDir;

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

const llmApiKey = fileSettings?.llm?.apiKey ?? '';
const llmModel = fileSettings?.llm?.model ?? 'gpt-4-turbo-preview';
const llmBaseUrl = fileSettings?.llm?.baseUrl ?? 'https://api.openai.com/v1';
const frontendPort = fileSettings?.server?.frontendPort?.toString() ?? (process.env.FRONTEND_PORT || '31416');
const backendPort = fileSettings?.server?.port ?? (parseInt(process.env.PORT || '', 10) || 31415);
const analysisEngineManifestPath = fileSettings?.analysis?.engineManifestPath
  ?? path.join(runtimeBaseDir, 'analysis-engines.json');
const defaultAnalysisPythonBin = process.platform === 'win32'
  ? path.join(runtimeBaseDir, '.venv', 'Scripts', 'python.exe')
  : path.join(runtimeBaseDir, '.venv', 'bin', 'python');

const defaultCorsOrigins = [
  `http://localhost:${frontendPort}`,
  `http://127.0.0.1:${frontendPort}`,
  `http://localhost:${backendPort}`,
  `http://127.0.0.1:${backendPort}`,
];

const corsOrigins = (fileSettings?.cors?.origins ?? defaultCorsOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export { runtimeBaseDir };

export const config = {
  // 服务配置
  port: typeof backendPort === 'number' ? backendPort : parseInt(String(backendPort), 10),
  host: fileSettings?.server?.host ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  bodyLimitMb: fileSettings?.server?.bodyLimitMb ?? 20,
  frontendPort: parseInt(frontendPort, 10),

  // 数据库配置
  databaseUrl: fileSettings?.database?.url ?? defaultSqliteDatabaseUrl,

  // AI 配置
  llmApiKey,
  llmModel,
  llmBaseUrl,
  llmTimeoutMs: fileSettings?.llm?.timeoutMs ?? 180000,
  llmMaxRetries: fileSettings?.llm?.maxRetries ?? 0,

  // 分析执行配置
  analysisPythonBin: fileSettings?.analysis?.pythonBin ?? defaultAnalysisPythonBin,
  analysisPythonTimeoutMs: fileSettings?.analysis?.pythonTimeoutMs ?? 600000,
  analysisEngineManifestPath,

  // CORS
  corsOrigins,

  // 文件存储
  reportsDir: resolveReportsDir(fileSettings?.storage?.reportsDir),
  maxFileSize: fileSettings?.storage?.maxFileSize ?? 104857600,

  // 日志级别
  logLevel: fileSettings?.logging?.level ?? 'info',
  /** 应用日志文件路径；默认 <runtimeBaseDir>/logs/app.log */
  logFile: path.join(runtimeBaseDir, 'logs', 'app.log'),
  /** 日志轮换：保留天数（默认 7 天） */
  logMaxAgeDays: fileSettings?.logging?.logMaxAgeDays ?? 7,
  /** 日志轮换：单文件最大字节数（默认 100MB） */
  logMaxSize: fileSettings?.logging?.logMaxSize ?? 104857600,

  // LLM 调用日志（默认关闭，设置 llmLogEnabled: true 开启）
  llmLogEnabled: fileSettings?.logging?.llmLogEnabled ?? false,
  llmLogDir: fileSettings?.logging?.llmLogDir ?? path.join(runtimeBaseDir, 'logs'),

  // Agent 配置
  agentWorkspaceRoot: fileSettings?.agent?.workspaceRoot ?? runtimeBaseDir,
  agentCheckpointDir: fileSettings?.agent?.checkpointDir ?? path.join(runtimeBaseDir, 'agent-checkpoints'),
  agentAllowShell: fileSettings?.agent?.allowShell ?? false,
  agentAllowedShells: fileSettings?.agent?.allowedShellCommands ?? 'node,npm,python,python3,./sclaw,./sclaw_cn',
  agentShellTimeoutMs: fileSettings?.agent?.shellTimeoutMs ?? 300000,

  // PKPM 引擎配置
  pkpmCyclePath: fileSettings?.pkpm?.cyclePath ?? '',
  pkpmWorkDir: fileSettings?.pkpm?.workDir ?? path.join(runtimeBaseDir, 'analysis', 'pkpm'),

  // YJK 引擎配置
  yjkInstallRoot: fileSettings?.yjk?.installRoot ?? '',
  yjkExePath: fileSettings?.yjk?.exePath ?? '',
  yjkPythonBin: fileSettings?.yjk?.pythonBin ?? '',
  yjkWorkDir: fileSettings?.yjk?.workDir ?? path.join(runtimeBaseDir, 'analysis', 'yjk'),
  yjkVersion: fileSettings?.yjk?.version ?? '8.0.0',
  yjkTimeoutS: fileSettings?.yjk?.timeoutS ?? 600,
  yjkInvisible: fileSettings?.yjk?.invisible ?? false,
  yjkLauncherPrewarm: fileSettings?.yjk?.launcherPrewarm ?? 'auto',
  yjkLauncherPrewarmS: fileSettings?.yjk?.launcherPrewarmS ?? 18,
  yjkDirectReadyTimeoutS: fileSettings?.yjk?.directReadyTimeoutS ?? 12,
};

export type Config = typeof config;

// Expose DATABASE_URL for Prisma CLI / tooling that reads process.env directly
process.env.DATABASE_URL = config.databaseUrl;
