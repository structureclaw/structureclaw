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

const frontendPort = fileSettings?.server?.frontendPort?.toString() ?? (process.env.FRONTEND_PORT || '31416');
const backendPort = fileSettings?.server?.port ?? (parseInt(process.env.PORT || '', 10) || 31415);
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

const LLM_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4-turbo-preview',
  timeoutMs: 180000,
  maxRetries: 0,
} as const;

const ANALYSIS_DEFAULTS = {
  engineManifestPath: path.join(runtimeBaseDir, 'analysis-engines.json'),
  pythonTimeoutMs: 600000,
} as const;

const AGENT_DEFAULTS = {
  workspaceRoot: runtimeBaseDir,
  checkpointDir: path.join(runtimeBaseDir, 'agent-checkpoints'),
  allowShell: false,
  allowedShellCommands: 'node,npm,python,python3,./sclaw,./sclaw_cn',
  shellTimeoutMs: 300000,
} as const;

const PKPM_DEFAULTS = {
  cyclePath: '',
  workDir: path.join(runtimeBaseDir, 'analysis', 'pkpm'),
} as const;

const YJK_DEFAULTS = {
  installRoot: '',
  exePath: '',
  pythonBin: '',
  workDir: path.join(runtimeBaseDir, 'analysis', 'yjk'),
  version: '8.0.0',
  timeoutS: 600,
  invisible: false,
  launcherPrewarm: 'auto',
  launcherPrewarmS: 18,
  directReadyTimeoutS: 12,
} as const;

function getCurrentLlmSettings() {
  return readSettingsFile()?.llm;
}

function getCurrentAnalysisSettings() {
  return readSettingsFile()?.analysis;
}

function getCurrentAgentSettings() {
  return readSettingsFile()?.agent;
}

function getCurrentPkpmSettings() {
  return readSettingsFile()?.pkpm;
}

function getCurrentYjkSettings() {
  return readSettingsFile()?.yjk;
}

export const config = {
  // 服务配置
  port: typeof backendPort === 'number' ? backendPort : parseInt(String(backendPort), 10),
  host: fileSettings?.server?.host ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  bodyLimitMb: fileSettings?.server?.bodyLimitMb ?? 20,
  frontendPort: parseInt(frontendPort, 10),

  // 数据库配置
  databaseUrl: process.env.DATABASE_URL || fileSettings?.database?.url || defaultSqliteDatabaseUrl,

  // AI 配置
  get llmApiKey() {
    return getCurrentLlmSettings()?.apiKey ?? '';
  },
  get llmModel() {
    return getCurrentLlmSettings()?.model || process.env.LLM_MODEL || LLM_DEFAULTS.model;
  },
  get llmBaseUrl() {
    return getCurrentLlmSettings()?.baseUrl || process.env.LLM_BASE_URL || LLM_DEFAULTS.baseUrl;
  },
  get llmTimeoutMs() {
    return getCurrentLlmSettings()?.timeoutMs ?? LLM_DEFAULTS.timeoutMs;
  },
  get llmMaxRetries() {
    return getCurrentLlmSettings()?.maxRetries ?? LLM_DEFAULTS.maxRetries;
  },

  // 分析执行配置
  get analysisPythonBin() {
    return getCurrentAnalysisSettings()?.pythonBin ?? defaultAnalysisPythonBin;
  },
  get analysisPythonTimeoutMs() {
    return getCurrentAnalysisSettings()?.pythonTimeoutMs ?? ANALYSIS_DEFAULTS.pythonTimeoutMs;
  },
  get analysisEngineManifestPath() {
    return getCurrentAnalysisSettings()?.engineManifestPath ?? ANALYSIS_DEFAULTS.engineManifestPath;
  },

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
  get agentWorkspaceRoot() {
    return getCurrentAgentSettings()?.workspaceRoot ?? AGENT_DEFAULTS.workspaceRoot;
  },
  get agentCheckpointDir() {
    return getCurrentAgentSettings()?.checkpointDir ?? AGENT_DEFAULTS.checkpointDir;
  },
  get agentAllowShell() {
    return getCurrentAgentSettings()?.allowShell ?? AGENT_DEFAULTS.allowShell;
  },
  get agentAllowedShells() {
    return getCurrentAgentSettings()?.allowedShellCommands ?? AGENT_DEFAULTS.allowedShellCommands;
  },
  get agentShellTimeoutMs() {
    return getCurrentAgentSettings()?.shellTimeoutMs ?? AGENT_DEFAULTS.shellTimeoutMs;
  },

  // PKPM 引擎配置
  get pkpmCyclePath() {
    return getCurrentPkpmSettings()?.cyclePath ?? PKPM_DEFAULTS.cyclePath;
  },
  get pkpmWorkDir() {
    return getCurrentPkpmSettings()?.workDir ?? PKPM_DEFAULTS.workDir;
  },

  // YJK 引擎配置
  get yjkInstallRoot() {
    return getCurrentYjkSettings()?.installRoot ?? YJK_DEFAULTS.installRoot;
  },
  get yjkExePath() {
    return getCurrentYjkSettings()?.exePath ?? YJK_DEFAULTS.exePath;
  },
  get yjkPythonBin() {
    return getCurrentYjkSettings()?.pythonBin ?? YJK_DEFAULTS.pythonBin;
  },
  get yjkWorkDir() {
    return getCurrentYjkSettings()?.workDir ?? YJK_DEFAULTS.workDir;
  },
  get yjkVersion() {
    return getCurrentYjkSettings()?.version ?? YJK_DEFAULTS.version;
  },
  get yjkTimeoutS() {
    return getCurrentYjkSettings()?.timeoutS ?? YJK_DEFAULTS.timeoutS;
  },
  get yjkInvisible() {
    return getCurrentYjkSettings()?.invisible ?? YJK_DEFAULTS.invisible;
  },
  get yjkLauncherPrewarm() {
    return getCurrentYjkSettings()?.launcherPrewarm ?? YJK_DEFAULTS.launcherPrewarm;
  },
  get yjkLauncherPrewarmS() {
    return getCurrentYjkSettings()?.launcherPrewarmS ?? YJK_DEFAULTS.launcherPrewarmS;
  },
  get yjkDirectReadyTimeoutS() {
    return getCurrentYjkSettings()?.directReadyTimeoutS ?? YJK_DEFAULTS.directReadyTimeoutS;
  },
};

export type Config = typeof config;

// Expose DATABASE_URL for Prisma CLI / tooling that reads process.env directly
process.env.DATABASE_URL = config.databaseUrl;
