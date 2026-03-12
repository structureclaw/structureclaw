import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');

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
const corePort = process.env.CORE_PORT || '8001';

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

  // 数据库配置
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/structureclaw',

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

  // 分析引擎配置
  analysisEngineUrl: process.env.ANALYSIS_ENGINE_URL || `http://localhost:${corePort}`,

  // CORS
  corsOrigins,

  // 文件存储
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB

  // 日志级别
  logLevel: process.env.LOG_LEVEL || 'info',
};

export type Config = typeof config;
