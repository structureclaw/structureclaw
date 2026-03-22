import dotenv from 'dotenv';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const defaultSqliteDatabasePath = path.resolve(__dirname, '../../../.runtime/data/structureclaw.db');
const defaultSqliteDatabaseUrl = `file:${defaultSqliteDatabasePath}`;

dotenv.config({ path: rootEnvPath });

const redisUrlRaw = process.env.REDIS_URL;
const redisEnabled = redisUrlRaw && redisUrlRaw.toLowerCase() !== 'disabled';
const llmProviderRaw = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
const llmProvider = ['openai', 'zhipu', 'openai-compatible'].includes(llmProviderRaw)
  ? llmProviderRaw
  : 'openai';
const isZhipu = llmProvider === 'zhipu';
const llmApiKey = process.env.LLM_API_KEY
  || (isZhipu ? process.env.ZAI_API_KEY : process.env.OPENAI_API_KEY)
  || '';
const llmModel = process.env.LLM_MODEL
  || (isZhipu ? 'glm-4-plus' : (process.env.OPENAI_MODEL || 'gpt-4-turbo-preview'));
const llmBaseUrl = process.env.LLM_BASE_URL
  || (isZhipu ? 'https://open.bigmodel.cn/api/paas/v4/' : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'));
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

  // Redis 配置
  redisUrl: redisEnabled ? redisUrlRaw! : '',

  // JWT 配置
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // AI 配置
  llmProvider,
  llmApiKey,
  llmModel,
  llmBaseUrl,
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '90000', 10),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || '0', 10),

  // 兼容保留：旧 OpenAI 字段
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',

  // 分析执行配置
  analysisPythonBin: process.env.ANALYSIS_PYTHON_BIN || defaultAnalysisPythonBin,
  analysisPythonTimeoutMs: parseInt(process.env.ANALYSIS_PYTHON_TIMEOUT_MS || '300000', 10),
  analysisEngineManifestPath,

  // CORS
  corsOrigins,

  // 文件存储
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB

  // 日志级别
  logLevel: process.env.LOG_LEVEL || 'info',
};

export type Config = typeof config;
