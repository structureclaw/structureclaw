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
  type SettingsFileStorage,
  type SettingsFileCors,
  type SettingsFileAgent,
  type SettingsFilePkpm,
  type SettingsFileYjk,
} from '../config/settings-file.js';

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

type ValueSource = 'runtime' | 'default';

function stringSource(
  runtimeValue: string | undefined,
  defaultValue: string,
): { value: string; source: ValueSource } {
  if (runtimeValue !== undefined && runtimeValue !== '') {
    return { value: runtimeValue, source: 'runtime' };
  }
  return { value: defaultValue, source: 'default' };
}

function numberSource(
  runtimeValue: number | undefined,
  defaultValue: number,
): { value: number; source: ValueSource } {
  if (runtimeValue !== undefined) {
    return { value: runtimeValue, source: 'runtime' };
  }
  return { value: defaultValue, source: 'default' };
}

function booleanSource(
  runtimeValue: boolean | undefined,
  defaultValue: boolean,
): { value: boolean; source: ValueSource } {
  if (runtimeValue !== undefined) {
    return { value: runtimeValue, source: 'runtime' };
  }
  return { value: defaultValue, source: 'default' };
}

// ---------------------------------------------------------------------------
// GET response builder
// ---------------------------------------------------------------------------

type ValueField<T> = { value: T; source: ValueSource };

type SettingsResponse = {
  server: {
    port: ValueField<number>;
    host: ValueField<string>;
    bodyLimitMb: ValueField<number>;
    frontendPort: ValueField<number>;
  };
  llm: {
    baseUrl: ValueField<string>;
    model: ValueField<string>;
    hasApiKey: boolean;
    apiKeySource: 'runtime' | 'unset';
    timeoutMs: ValueField<number>;
    maxRetries: ValueField<number>;
  };
  database: {
    url: ValueField<string>;
  };
  logging: {
    level: ValueField<string>;
    llmLogEnabled: ValueField<boolean>;
    logMaxAgeDays: ValueField<number>;
    logMaxSize: ValueField<number>;
    llmLogDir: ValueField<string>;
  };
  analysis: {
    pythonBin: ValueField<string>;
    pythonTimeoutMs: ValueField<number>;
    engineManifestPath: ValueField<string>;
  };
  storage: {
    reportsDir: ValueField<string>;
    maxFileSize: ValueField<number>;
  };
  cors: {
    origins: ValueField<string>;
  };
  agent: {
    workspaceRoot: ValueField<string>;
    checkpointDir: ValueField<string>;
    allowShell: ValueField<boolean>;
    allowedShellCommands: ValueField<string>;
    shellTimeoutMs: ValueField<number>;
  };
  pkpm: {
    cyclePath: ValueField<string>;
    workDir: ValueField<string>;
  };
  yjk: {
    installRoot: ValueField<string>;
    exePath: ValueField<string>;
    pythonBin: ValueField<string>;
    workDir: ValueField<string>;
    version: ValueField<string>;
    timeoutS: ValueField<number>;
    invisible: ValueField<boolean>;
  };
};

function buildSettingsResponse(): SettingsResponse {
  const file = readSettingsFile();
  const defaults = {
    port: 31415,
    host: '0.0.0.0',
    bodyLimitMb: 20,
    frontendPort: 31416,
    llmBaseUrl: 'https://api.openai.com/v1',
    llmModel: 'gpt-4-turbo-preview',
    llmTimeoutMs: 180000,
    llmMaxRetries: 0,
    databaseUrl: config.databaseUrl,
    logLevel: 'info',
    llmLogEnabled: false,
    logMaxAgeDays: 7,
    logMaxSize: 104857600,
    llmLogDir: '',
    pythonBin: '',
    pythonTimeoutMs: 600000,
    engineManifestPath: '',
    reportsDir: '',
    maxFileSize: 104857600,
    corsOrigins: '',
    workspaceRoot: '',
    checkpointDir: '',
    allowShell: false,
    allowedShellCommands: 'node,npm,python,python3,./sclaw,./sclaw_cn',
    shellTimeoutMs: 300000,
    pkpmCyclePath: '',
    pkpmWorkDir: '',
    yjkInstallRoot: '',
    yjkExePath: '',
    yjkPythonBin: '',
    yjkWorkDir: '',
    yjkVersion: '8.0.0',
    yjkTimeoutS: 600,
    yjkInvisible: false,
  };

  const hasApiKey = config.llmApiKey.trim().length > 0;
  const apiKeySource: 'runtime' | 'unset' = hasApiKey ? 'runtime' : 'unset';

  return {
    server: {
      port: numberSource(file?.server?.port, defaults.port),
      host: stringSource(file?.server?.host, defaults.host),
      bodyLimitMb: numberSource(file?.server?.bodyLimitMb, defaults.bodyLimitMb),
      frontendPort: numberSource(file?.server?.frontendPort, defaults.frontendPort),
    },
    llm: {
      baseUrl: stringSource(file?.llm?.baseUrl, defaults.llmBaseUrl),
      model: stringSource(file?.llm?.model, defaults.llmModel),
      hasApiKey,
      apiKeySource,
      timeoutMs: numberSource(file?.llm?.timeoutMs, defaults.llmTimeoutMs),
      maxRetries: numberSource(file?.llm?.maxRetries, defaults.llmMaxRetries),
    },
    database: {
      url: stringSource(file?.database?.url, defaults.databaseUrl),
    },
    logging: {
      level: stringSource(file?.logging?.level, defaults.logLevel),
      llmLogEnabled: booleanSource(file?.logging?.llmLogEnabled, defaults.llmLogEnabled),
      logMaxAgeDays: numberSource(file?.logging?.logMaxAgeDays, defaults.logMaxAgeDays),
      logMaxSize: numberSource(file?.logging?.logMaxSize, defaults.logMaxSize),
      llmLogDir: stringSource(file?.logging?.llmLogDir, defaults.llmLogDir),
    },
    analysis: {
      pythonBin: stringSource(file?.analysis?.pythonBin, defaults.pythonBin),
      pythonTimeoutMs: numberSource(file?.analysis?.pythonTimeoutMs, defaults.pythonTimeoutMs),
      engineManifestPath: stringSource(file?.analysis?.engineManifestPath, defaults.engineManifestPath),
    },
    storage: {
      reportsDir: stringSource(file?.storage?.reportsDir, defaults.reportsDir),
      maxFileSize: numberSource(file?.storage?.maxFileSize, defaults.maxFileSize),
    },
    cors: {
      origins: stringSource(file?.cors?.origins, defaults.corsOrigins),
    },
    agent: {
      workspaceRoot: stringSource(file?.agent?.workspaceRoot, defaults.workspaceRoot),
      checkpointDir: stringSource(file?.agent?.checkpointDir, defaults.checkpointDir),
      allowShell: booleanSource(file?.agent?.allowShell, defaults.allowShell),
      allowedShellCommands: stringSource(file?.agent?.allowedShellCommands, defaults.allowedShellCommands),
      shellTimeoutMs: numberSource(file?.agent?.shellTimeoutMs, defaults.shellTimeoutMs),
    },
    pkpm: {
      cyclePath: stringSource(file?.pkpm?.cyclePath, defaults.pkpmCyclePath),
      workDir: stringSource(file?.pkpm?.workDir, defaults.pkpmWorkDir),
    },
    yjk: {
      installRoot: stringSource(file?.yjk?.installRoot, defaults.yjkInstallRoot),
      exePath: stringSource(file?.yjk?.exePath, defaults.yjkExePath),
      pythonBin: stringSource(file?.yjk?.pythonBin, defaults.yjkPythonBin),
      workDir: stringSource(file?.yjk?.workDir, defaults.yjkWorkDir),
      version: stringSource(file?.yjk?.version, defaults.yjkVersion),
      timeoutS: numberSource(file?.yjk?.timeoutS, defaults.yjkTimeoutS),
      invisible: booleanSource(file?.yjk?.invisible, defaults.yjkInvisible),
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
    bodyLimitMb: z.number().int().min(1).optional(),
    frontendPort: z.number().int().min(1).max(65535).optional(),
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
    llmLogDir: z.string().trim().optional(),
  }).optional(),
  analysis: z.object({
    pythonBin: z.string().trim().optional(),
    pythonTimeoutMs: z.number().int().min(1000).optional(),
    engineManifestPath: z.string().trim().optional(),
  }).optional(),
  storage: z.object({
    reportsDir: z.string().trim().optional(),
    maxFileSize: z.number().int().min(1).optional(),
  }).optional(),
  cors: z.object({
    origins: z.string().trim().optional(),
  }).optional(),
  agent: z.object({
    workspaceRoot: z.string().trim().optional(),
    checkpointDir: z.string().trim().optional(),
    allowShell: z.boolean().optional(),
    allowedShellCommands: z.string().trim().optional(),
    shellTimeoutMs: z.number().int().min(1000).optional(),
  }).optional(),
  pkpm: z.object({
    cyclePath: z.string().trim().optional(),
    workDir: z.string().trim().optional(),
  }).optional(),
  yjk: z.object({
    installRoot: z.string().trim().optional(),
    exePath: z.string().trim().optional(),
    pythonBin: z.string().trim().optional(),
    workDir: z.string().trim().optional(),
    version: z.string().trim().optional(),
    timeoutS: z.number().int().min(1).optional(),
    invisible: z.boolean().optional(),
  }).optional(),
});

type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

function applyUpdate(current: SettingsFile, input: UpdateSettingsInput): SettingsFile {
  const next: SettingsFile = { ...current };

  if (input.server) {
    const server: SettingsFileServer = { ...(current.server ?? {}) };
    if (input.server.port !== undefined) server.port = input.server.port;
    if (input.server.host !== undefined) server.host = input.server.host;
    if (input.server.bodyLimitMb !== undefined) server.bodyLimitMb = input.server.bodyLimitMb;
    if (input.server.frontendPort !== undefined) server.frontendPort = input.server.frontendPort;
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
    if (input.logging.llmLogDir !== undefined) logging.llmLogDir = input.logging.llmLogDir;
    next.logging = logging;
  }

  if (input.analysis) {
    const analysis: SettingsFileAnalysis = { ...(current.analysis ?? {}) };
    if (input.analysis.pythonBin !== undefined) analysis.pythonBin = input.analysis.pythonBin;
    if (input.analysis.pythonTimeoutMs !== undefined) analysis.pythonTimeoutMs = input.analysis.pythonTimeoutMs;
    if (input.analysis.engineManifestPath !== undefined) analysis.engineManifestPath = input.analysis.engineManifestPath;
    next.analysis = analysis;
  }

  if (input.storage) {
    const storage: SettingsFileStorage = { ...(current.storage ?? {}) };
    if (input.storage.reportsDir !== undefined) storage.reportsDir = input.storage.reportsDir;
    if (input.storage.maxFileSize !== undefined) storage.maxFileSize = input.storage.maxFileSize;
    next.storage = storage;
  }

  if (input.cors) {
    const cors: SettingsFileCors = { ...(current.cors ?? {}) };
    if (input.cors.origins !== undefined) cors.origins = input.cors.origins;
    next.cors = cors;
  }

  if (input.agent) {
    const agent: SettingsFileAgent = { ...(current.agent ?? {}) };
    if (input.agent.workspaceRoot !== undefined) agent.workspaceRoot = input.agent.workspaceRoot;
    if (input.agent.checkpointDir !== undefined) agent.checkpointDir = input.agent.checkpointDir;
    if (input.agent.allowShell !== undefined) agent.allowShell = input.agent.allowShell;
    if (input.agent.allowedShellCommands !== undefined) agent.allowedShellCommands = input.agent.allowedShellCommands;
    if (input.agent.shellTimeoutMs !== undefined) agent.shellTimeoutMs = input.agent.shellTimeoutMs;
    next.agent = agent;
  }

  if (input.pkpm) {
    const pkpm: SettingsFilePkpm = { ...(current.pkpm ?? {}) };
    if (input.pkpm.cyclePath !== undefined) pkpm.cyclePath = input.pkpm.cyclePath;
    if (input.pkpm.workDir !== undefined) pkpm.workDir = input.pkpm.workDir;
    next.pkpm = pkpm;
  }

  if (input.yjk) {
    const yjk: SettingsFileYjk = { ...(current.yjk ?? {}) };
    if (input.yjk.installRoot !== undefined) yjk.installRoot = input.yjk.installRoot;
    if (input.yjk.exePath !== undefined) yjk.exePath = input.yjk.exePath;
    if (input.yjk.pythonBin !== undefined) yjk.pythonBin = input.yjk.pythonBin;
    if (input.yjk.workDir !== undefined) yjk.workDir = input.yjk.workDir;
    if (input.yjk.version !== undefined) yjk.version = input.yjk.version;
    if (input.yjk.timeoutS !== undefined) yjk.timeoutS = input.yjk.timeoutS;
    if (input.yjk.invisible !== undefined) yjk.invisible = input.yjk.invisible;
    next.yjk = yjk;
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
