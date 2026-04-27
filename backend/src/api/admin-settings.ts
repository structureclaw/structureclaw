import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config/index.js';
import {
  readSettingsFile,
  writeSettingsFile,
  type SettingsFile,
  type SettingsFileServer,
  type SettingsFileLlm,
  type SettingsFileLogging,
  type SettingsFileAnalysis,
} from '../config/settings-file.js';

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

type ValueSource = 'runtime' | 'env' | 'default';

function stringSource(
  runtimeValue: string | undefined,
  envValue: string | undefined,
  defaultValue: string,
): { value: string; source: ValueSource } {
  if (runtimeValue !== undefined && runtimeValue !== '') {
    return { value: runtimeValue, source: 'runtime' };
  }
  if (envValue !== undefined && envValue !== '') {
    return { value: envValue, source: 'env' };
  }
  return { value: defaultValue, source: 'default' };
}

function numberSource(
  runtimeValue: number | undefined,
  envValue: number | undefined,
  defaultValue: number,
): { value: number; source: ValueSource } {
  if (runtimeValue !== undefined) {
    return { value: runtimeValue, source: 'runtime' };
  }
  if (envValue !== undefined) {
    return { value: envValue, source: 'env' };
  }
  return { value: defaultValue, source: 'default' };
}

function booleanSource(
  runtimeValue: boolean | undefined,
  envValue: boolean | undefined,
  defaultValue: boolean,
): { value: boolean; source: ValueSource } {
  if (runtimeValue !== undefined) {
    return { value: runtimeValue, source: 'runtime' };
  }
  if (envValue !== undefined) {
    return { value: envValue, source: 'env' };
  }
  return { value: defaultValue, source: 'default' };
}

// ---------------------------------------------------------------------------
// GET response builder
// ---------------------------------------------------------------------------

type SettingsResponse = {
  server: {
    port: { value: number; source: ValueSource };
    host: { value: string; source: ValueSource };
  };
  llm: {
    baseUrl: { value: string; source: ValueSource };
    model: { value: string; source: ValueSource };
    hasApiKey: boolean;
    apiKeySource: 'runtime' | 'env' | 'unset';
    timeoutMs: { value: number; source: ValueSource };
    maxRetries: { value: number; source: ValueSource };
  };
  database: {
    url: { value: string; source: ValueSource };
  };
  logging: {
    level: { value: string; source: ValueSource };
    llmLogEnabled: { value: boolean; source: ValueSource };
    logMaxAgeDays: { value: number; source: ValueSource };
    logMaxSize: { value: number; source: ValueSource };
  };
  analysis: {
    pythonBin: { value: string; source: ValueSource };
    pythonTimeoutMs: { value: number; source: ValueSource };
  };
};

function buildSettingsResponse(): SettingsResponse {
  const file = readSettingsFile();
  const defaults = {
    port: 8000,
    host: '0.0.0.0',
    llmBaseUrl: 'https://api.openai.com/v1',
    llmModel: 'gpt-4-turbo-preview',
    llmTimeoutMs: 180000,
    llmMaxRetries: 0,
    databaseUrl: config.databaseUrl,
    logLevel: 'info',
    llmLogEnabled: false,
    logMaxAgeDays: 7,
    logMaxSize: 104857600,
    pythonBin: '',
    pythonTimeoutMs: 600000,
  };

  const hasApiKey = config.llmApiKey.trim().length > 0;
  const apiKeyRuntime = file?.llm?.apiKey;
  const apiKeyEnv = process.env.LLM_API_KEY;

  let apiKeySource: 'runtime' | 'env' | 'unset' = 'unset';
  if (apiKeyRuntime) {
    apiKeySource = 'runtime';
  } else if (apiKeyEnv && apiKeyEnv.trim().length > 0) {
    apiKeySource = 'env';
  }

  return {
    server: {
      port: numberSource(file?.server?.port, parseInt(process.env.PORT || '', 10) || undefined, defaults.port),
      host: stringSource(file?.server?.host, process.env.HOST, defaults.host),
    },
    llm: {
      baseUrl: stringSource(file?.llm?.baseUrl, process.env.LLM_BASE_URL, defaults.llmBaseUrl),
      model: stringSource(file?.llm?.model, process.env.LLM_MODEL, defaults.llmModel),
      hasApiKey,
      apiKeySource,
      timeoutMs: numberSource(file?.llm?.timeoutMs, parseInt(process.env.LLM_TIMEOUT_MS || '', 10) || undefined, defaults.llmTimeoutMs),
      maxRetries: numberSource(file?.llm?.maxRetries, parseInt(process.env.LLM_MAX_RETRIES || '', 10) || undefined, defaults.llmMaxRetries),
    },
    database: {
      url: stringSource(file?.database?.url, process.env.DATABASE_URL, defaults.databaseUrl),
    },
    logging: {
      level: stringSource(file?.logging?.level, process.env.LOG_LEVEL, defaults.logLevel),
      llmLogEnabled: booleanSource(file?.logging?.llmLogEnabled, process.env.LLM_LOG_ENABLED === 'true' ? true : undefined, defaults.llmLogEnabled),
      logMaxAgeDays: numberSource(file?.logging?.logMaxAgeDays, parseInt(process.env.LOG_MAX_AGE_DAYS || '', 10) || undefined, defaults.logMaxAgeDays),
      logMaxSize: numberSource(file?.logging?.logMaxSize, parseInt(process.env.LOG_MAX_SIZE || '', 10) || undefined, defaults.logMaxSize),
    },
    analysis: {
      pythonBin: stringSource(file?.analysis?.pythonBin, process.env.ANALYSIS_PYTHON_BIN, defaults.pythonBin),
      pythonTimeoutMs: numberSource(file?.analysis?.pythonTimeoutMs, parseInt(process.env.ANALYSIS_PYTHON_TIMEOUT_MS || '', 10) || undefined, defaults.pythonTimeoutMs),
    },
  };
}

// ---------------------------------------------------------------------------
// PUT input validation
// ---------------------------------------------------------------------------

const updateSettingsSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535).optional(),
    host: z.string().trim().min(1).optional(),
  }).optional(),
  llm: z.object({
    baseUrl: z.string().trim().url().optional(),
    model: z.string().trim().min(1).optional(),
    apiKey: z.string().optional(),
    apiKeyMode: z.enum(['keep', 'replace', 'inherit']).optional(),
    timeoutMs: z.number().int().min(0).optional(),
    maxRetries: z.number().int().min(0).optional(),
  }).optional(),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
    llmLogEnabled: z.boolean().optional(),
    logMaxAgeDays: z.number().int().min(1).optional(),
    logMaxSize: z.number().int().min(1).optional(),
  }).optional(),
  analysis: z.object({
    pythonBin: z.string().trim().optional(),
    pythonTimeoutMs: z.number().int().min(1000).optional(),
  }).optional(),
});

type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

function applyUpdate(current: SettingsFile, input: UpdateSettingsInput): SettingsFile {
  const next: SettingsFile = { ...current };

  if (input.server) {
    const server: SettingsFileServer = { ...(current.server ?? {}) };
    if (input.server.port !== undefined) server.port = input.server.port;
    if (input.server.host !== undefined) server.host = input.server.host;
    next.server = server;
  }

  if (input.llm) {
    const llm: SettingsFileLlm = { ...(current.llm ?? {}) };
    if (input.llm.baseUrl !== undefined) llm.baseUrl = input.llm.baseUrl;
    if (input.llm.model !== undefined) llm.model = input.llm.model;
    if (input.llm.timeoutMs !== undefined) llm.timeoutMs = input.llm.timeoutMs;
    if (input.llm.maxRetries !== undefined) llm.maxRetries = input.llm.maxRetries;

    const apiKeyMode = input.llm.apiKeyMode || 'keep';
    if (apiKeyMode === 'inherit') {
      llm.apiKey = undefined;
    } else if (apiKeyMode === 'replace' && input.llm.apiKey !== undefined) {
      llm.apiKey = input.llm.apiKey.trim() || undefined;
    }
    next.llm = llm;
  }

  if (input.logging) {
    const logging: SettingsFileLogging = { ...(current.logging ?? {}) };
    if (input.logging.level !== undefined) logging.level = input.logging.level;
    if (input.logging.llmLogEnabled !== undefined) logging.llmLogEnabled = input.logging.llmLogEnabled;
    if (input.logging.logMaxAgeDays !== undefined) logging.logMaxAgeDays = input.logging.logMaxAgeDays;
    if (input.logging.logMaxSize !== undefined) logging.logMaxSize = input.logging.logMaxSize;
    next.logging = logging;
  }

  if (input.analysis) {
    const analysis: SettingsFileAnalysis = { ...(current.analysis ?? {}) };
    if (input.analysis.pythonBin !== undefined) analysis.pythonBin = input.analysis.pythonBin;
    if (input.analysis.pythonTimeoutMs !== undefined) analysis.pythonTimeoutMs = input.analysis.pythonTimeoutMs;
    next.analysis = analysis;
  }

  return next;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function adminSettingsRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Get all application settings with source labels',
    },
  }, async () => buildSettingsResponse());

  fastify.put('/', {
    schema: {
      tags: ['Admin'],
      summary: 'Update application settings',
    },
  }, async (request: FastifyRequest<{ Body: UpdateSettingsInput }>) => {
    const parsed = updateSettingsSchema.parse(request.body);
    const current = readSettingsFile() ?? {};
    const updated = applyUpdate(current, parsed);
    writeSettingsFile(updated);
    return buildSettingsResponse();
  });
}
