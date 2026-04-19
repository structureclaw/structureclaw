import dotenv from 'dotenv';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const defaultSqliteDatabasePath = path.resolve(__dirname, '../../../.runtime/data/structureclaw.db');
const defaultSqliteDatabaseUrl = `file:${defaultSqliteDatabasePath}`;
const defaultUploadDir = path.resolve(__dirname, '../../../.runtime');

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

dotenv.config({ path: rootEnvPath });

const llmApiKey = process.env.LLM_API_KEY || '';
const llmModel = process.env.LLM_MODEL || 'gpt-4-turbo-preview';
const llmBaseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const frontendPort = process.env.FRONTEND_PORT || '30000';
const backendPort = process.env.PORT || '8000';
const analysisEngineManifestPath = process.env.ANALYSIS_ENGINE_MANIFEST_PATH || path.resolve(__dirname, '../../../.runtime/analysis-engines.json');
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

export const config = {
  // 服务配置
  port: parseInt(process.env.PORT || '8000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  bodyLimitMb: parseInt(process.env.BACKEND_BODY_LIMIT_MB || '20', 10),

  // 数据库配置
  databaseUrl: process.env.DATABASE_URL || defaultSqliteDatabaseUrl,

  // AI 配置
  llmApiKey,
  llmModel,
  llmBaseUrl,
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || '0', 10),

  // 分析执行配置
  analysisPythonBin: process.env.ANALYSIS_PYTHON_BIN || defaultAnalysisPythonBin,
  analysisPythonTimeoutMs: parseInt(process.env.ANALYSIS_PYTHON_TIMEOUT_MS || '600000', 10),
  analysisEngineManifestPath,

  // CORS
  corsOrigins,

  // 文件存储
  /** Agent 报告落盘目录；默认 <repo>/.runtime/reports */
  reportsDir: resolveReportsDir(process.env.REPORTS_DIR),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB

  // 日志级别
  logLevel: process.env.LOG_LEVEL || 'info',
  /** 应用日志文件路径；默认 <repo>/.runtime/logs/app.log */
  logFile: process.env.LOG_FILE || '',

  // LLM 调用日志（默认关闭，设置 LLM_LOG_ENABLED=true 开启；日志含完整 prompt/response，注意隐私）
  llmLogEnabled: process.env.LLM_LOG_ENABLED === 'true',
  llmLogDir: process.env.LLM_LOG_DIR || '',
};

export type Config = typeof config;
