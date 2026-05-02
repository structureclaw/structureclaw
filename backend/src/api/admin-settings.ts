import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config, runtimeBaseDir } from '../config/index.js';
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
): { value: string; source: ValueSource; defaultValue: string } {
  if (runtimeValue !== undefined && runtimeValue !== '') {
    return { value: runtimeValue, source: 'runtime', defaultValue };
  }
  return { value: defaultValue, source: 'default', defaultValue };
}

function numberSource(
  runtimeValue: number | undefined,
  defaultValue: number,
): { value: number; source: ValueSource; defaultValue: number } {
  if (runtimeValue !== undefined) {
    return { value: runtimeValue, source: 'runtime', defaultValue };
  }
  return { value: defaultValue, source: 'default', defaultValue };
}

function booleanSource(
  runtimeValue: boolean | undefined,
  defaultValue: boolean,
): { value: boolean; source: ValueSource; defaultValue: boolean } {
  if (runtimeValue !== undefined) {
    return { value: runtimeValue, source: 'runtime', defaultValue };
  }
  return { value: defaultValue, source: 'default', defaultValue };
}

// ---------------------------------------------------------------------------
// GET response builder
// ---------------------------------------------------------------------------

type ValueField<T> = { value: T; source: ValueSource; defaultValue: T };

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
    sdkArchivePath: ValueField<string>;
    workDir: ValueField<string>;
    version: ValueField<string>;
    timeoutS: ValueField<number>;
    invisible: ValueField<boolean>;
    launcherPrewarm: ValueField<string>;
    launcherPrewarmS: ValueField<number>;
    directReadyTimeoutS: ValueField<number>;
  };
};

function buildSettingsResponse(): SettingsResponse {
  const file = readSettingsFile();
  const parsedFrontendPort = parseInt(process.env.FRONTEND_PORT || '', 10);
  const defaultFrontendPort = Number.isFinite(parsedFrontendPort) ? parsedFrontendPort : 31416;
  const defaultBackendPort = parseInt(process.env.PORT || '', 10) || 31415;
  const effectiveFrontendPort = file?.server?.frontendPort ?? defaultFrontendPort;
  const effectiveBackendPort = file?.server?.port ?? defaultBackendPort;
  const defaults = {
    port: defaultBackendPort,
    host: '0.0.0.0',
    bodyLimitMb: 20,
    frontendPort: defaultFrontendPort,
    llmBaseUrl: 'https://api.openai.com/v1',
    llmModel: 'gpt-4-turbo-preview',
    llmTimeoutMs: 180000,
    llmMaxRetries: 0,
    databaseUrl: `file:${path.join(runtimeBaseDir, 'data', 'structureclaw.db')}`,
    logLevel: 'info',
    llmLogEnabled: false,
    logMaxAgeDays: 7,
    logMaxSize: 104857600,
    llmLogDir: path.join(runtimeBaseDir, 'logs'),
    pythonBin: process.platform === 'win32'
      ? path.join(runtimeBaseDir, '.venv', 'Scripts', 'python.exe')
      : path.join(runtimeBaseDir, '.venv', 'bin', 'python'),
    pythonTimeoutMs: 600000,
    engineManifestPath: path.join(runtimeBaseDir, 'analysis-engines.json'),
    reportsDir: path.join(runtimeBaseDir, 'reports'),
    maxFileSize: 104857600,
    corsOrigins: [
      `http://localhost:${effectiveFrontendPort}`,
      `http://127.0.0.1:${effectiveFrontendPort}`,
      `http://localhost:${effectiveBackendPort}`,
      `http://127.0.0.1:${effectiveBackendPort}`,
    ].join(','),
    workspaceRoot: runtimeBaseDir,
    checkpointDir: path.join(runtimeBaseDir, 'agent-checkpoints'),
    allowShell: false,
    allowedShellCommands: 'node,npm,python,python3,./sclaw,./sclaw_cn',
    shellTimeoutMs: 300000,
    pkpmCyclePath: '',
    pkpmWorkDir: path.join(runtimeBaseDir, 'analysis', 'pkpm'),
    yjkInstallRoot: '',
    yjkExePath: '',
    yjkPythonBin: '',
    yjkSdkArchivePath: '',
    yjkWorkDir: path.join(runtimeBaseDir, 'analysis', 'yjk'),
    yjkVersion: '8.0.0',
    yjkTimeoutS: 600,
    yjkInvisible: false,
    yjkLauncherPrewarm: 'auto',
    yjkLauncherPrewarmS: 18,
    yjkDirectReadyTimeoutS: 12,
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
      sdkArchivePath: stringSource(file?.yjk?.sdkArchivePath, defaults.yjkSdkArchivePath),
      workDir: stringSource(file?.yjk?.workDir, defaults.yjkWorkDir),
      version: stringSource(file?.yjk?.version, defaults.yjkVersion),
      timeoutS: numberSource(file?.yjk?.timeoutS, defaults.yjkTimeoutS),
      invisible: booleanSource(file?.yjk?.invisible, defaults.yjkInvisible),
      launcherPrewarm: stringSource(file?.yjk?.launcherPrewarm, defaults.yjkLauncherPrewarm),
      launcherPrewarmS: numberSource(file?.yjk?.launcherPrewarmS, defaults.yjkLauncherPrewarmS),
      directReadyTimeoutS: numberSource(file?.yjk?.directReadyTimeoutS, defaults.yjkDirectReadyTimeoutS),
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
    sdkArchivePath: z.string().trim().optional(),
    workDir: z.string().trim().optional(),
    version: z.string().trim().optional(),
    timeoutS: z.number().int().min(1).optional(),
    invisible: z.boolean().optional(),
    launcherPrewarm: z.enum(['auto', 'always', 'off']).optional(),
    launcherPrewarmS: z.number().int().min(0).optional(),
    directReadyTimeoutS: z.number().int().min(0).optional(),
  }).optional(),
});

type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

const yjkAutoConfigureSchema = z.object({
  yjk: updateSettingsSchema.shape.yjk.optional(),
});

type YjkAutoConfigureInput = z.infer<typeof yjkAutoConfigureSchema>;
type YjkAutoConfigureStep = {
  name: string;
  status: 'applied' | 'skipped';
  details?: string;
};

const YJK_API_REPO_URL = 'https://gitee.com/yjk-opensource/yjkapi_-python.git';
const YJK_API_BRANCH = '8.0';
const DEFAULT_YJK_COMMAND_TIMEOUT_MS = 300000;

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
    if (input.yjk.sdkArchivePath !== undefined) yjk.sdkArchivePath = input.yjk.sdkArchivePath;
    if (input.yjk.workDir !== undefined) yjk.workDir = input.yjk.workDir;
    if (input.yjk.version !== undefined) yjk.version = input.yjk.version;
    if (input.yjk.timeoutS !== undefined) yjk.timeoutS = input.yjk.timeoutS;
    if (input.yjk.invisible !== undefined) yjk.invisible = input.yjk.invisible;
    if (input.yjk.launcherPrewarm !== undefined) yjk.launcherPrewarm = input.yjk.launcherPrewarm;
    if (input.yjk.launcherPrewarmS !== undefined) yjk.launcherPrewarmS = input.yjk.launcherPrewarmS;
    if (input.yjk.directReadyTimeoutS !== undefined) yjk.directReadyTimeoutS = input.yjk.directReadyTimeoutS;
    next.yjk = yjk;
  }

  return next;
}

function findYjkExe(installRoot: string): string | undefined {
  for (const name of ['yjks.exe', 'YJKS.exe']) {
    const candidate = path.join(installRoot, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function findYjkPython(installRoot: string): string | undefined {
  for (const relative of [
    path.join('Python310', 'python.exe'),
    path.join('python310', 'python.exe'),
  ]) {
    const candidate = path.join(installRoot, relative);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function copyYjkSdkIntoInstallRoot(sdkSource: string, installRoot: string): number {
  const entries = fs.readdirSync(sdkSource, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sdkSource, entry.name);
    const target = path.join(installRoot, entry.name);
    try {
      fs.cpSync(source, target, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to copy YJKAPI SDK file "${entry.name}" into ${installRoot}: ${message}. `
        + 'Close YJK and any YJK bundled Python processes, then try again.',
        { cause: error },
      );
    }
  }
  return entries.length;
}

function yjkCommandTimeoutMs(): number {
  const parsed = Number(process.env.YJK_AUTO_CONFIG_COMMAND_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_YJK_COMMAND_TIMEOUT_MS;
}

function assertYjkInstallNotRunning(installRoot: string): void {
  if (process.platform !== 'win32') return;

  const script = [
    "$names = @('yjks.exe','python.exe','pythonw.exe')",
    "$root = [System.IO.Path]::GetFullPath($env:YJK_AUTO_CONFIG_INSTALL_ROOT).TrimEnd('\\')",
    "$items = Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and $_.ExecutablePath } | ForEach-Object {",
    "  $exe = [System.IO.Path]::GetFullPath($_.ExecutablePath)",
    "  if ($exe.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "    [PSCustomObject]@{ Name = $_.Name; ProcessId = $_.ProcessId; ExecutablePath = $exe }",
    "  }",
    "}",
    "$items | ConvertTo-Json -Compress",
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, YJK_AUTO_CONFIG_INSTALL_ROOT: installRoot },
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return;

  const output = result.stdout.trim();
  if (!output) return;

  let processes: Array<{ Name?: string; ProcessId?: number; ExecutablePath?: string }>;
  try {
    const parsed = JSON.parse(output) as unknown;
    processes = Array.isArray(parsed) ? parsed : [parsed as { Name?: string; ProcessId?: number; ExecutablePath?: string }];
  } catch {
    return;
  }
  const activeProcesses = processes
    .filter((item) => typeof item.Name === 'string' && typeof item.ExecutablePath === 'string');
  if (activeProcesses.length === 0) return;

  const pythonDir = path.join(installRoot, 'python310');
  const pythonDirAlt = path.join(installRoot, 'Python310');
  const activeNames = activeProcesses
    .map((item) => `${item.Name}${item.ProcessId ? `:${item.ProcessId}` : ''}`)
    .join(', ');
  const message = [
    `YJK appears to be running (${activeNames}).`,
    `The SDK copy step needs exclusive access to ${pythonDir} / ${pythonDirAlt}.`,
    'Close YJK and stop YJK bundled Python processes before running Auto Configure again.',
  ].join(' ');
  throw new Error(message);
}

function runRequiredCommand(command: string, args: string[], cwd?: string, timeoutMs = yjkCommandTimeoutMs()): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      throw new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

function runOptionalCommand(command: string, args: string[], cwd?: string, timeoutMs = 10000): string | undefined {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim();
}

function existingExecutable(candidates: string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function resolveGitCommand(): string | undefined {
  const configured = process.env.GIT_BIN?.trim();
  if (configured) {
    if (!fs.existsSync(configured) || !fs.statSync(configured).isFile()) {
      throw new Error(`GIT_BIN points to a missing git executable: ${configured}`);
    }
    return configured;
  }

  const commonWindowsGit = process.platform === 'win32'
    ? existingExecutable([
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    ])
    : undefined;
  if (commonWindowsGit) return commonWindowsGit;

  const probe = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return probe.error ? undefined : 'git';
}

function findRarExtractor(): { command: string; args: (archive: string, outputDir: string) => string[] } {
  const configured = process.env.YJK_7Z_BIN?.trim() || process.env.YJK_RAR_EXTRACTOR?.trim();
  if (configured) {
    // Environment override intentionally uses 7-Zip-compatible CLI arguments:
    // `x -y -o<outputDir> <archive>`.
    return { command: configured, args: (archive, outputDir) => ['x', '-y', `-o${outputDir}`, archive] };
  }

  const candidates = [
    {
      command: '7z',
      args: (archive: string, outputDir: string) => ['x', '-y', `-o${outputDir}`, archive],
    },
    {
      command: '7za',
      args: (archive: string, outputDir: string) => ['x', '-y', `-o${outputDir}`, archive],
    },
    {
      command: 'UnRAR',
      args: (archive: string, outputDir: string) => ['x', '-y', archive, `${outputDir}${path.sep}`],
    },
    {
      command: 'WinRAR',
      args: (archive: string, outputDir: string) => ['x', '-y', archive, `${outputDir}${path.sep}`],
    },
  ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (!probe.error) return candidate;
  }

  throw new Error('A RAR extractor was not found. Install 7-Zip/WinRAR or set YJK_7Z_BIN to a 7-Zip-compatible extractor.');
}

function yjkApiBranch(): string {
  return process.env.YJK_API_REPO_BRANCH?.trim() || YJK_API_BRANCH;
}

function safeCacheSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveYjkApiCacheDir(branch: string): string {
  return path.join(runtimeBaseDir, 'cache', 'yjkapi', safeCacheSegment(branch));
}

function syncYjkApiPublicRepo(steps: YjkAutoConfigureStep[]): string | undefined {
  const repoUrl = process.env.YJK_API_REPO_URL?.trim() || YJK_API_REPO_URL;
  const branch = yjkApiBranch();
  const gitCommand = resolveGitCommand();
  if (!gitCommand) {
    steps.push({
      name: 'Clone YJKAPI public repository',
      status: 'skipped',
      details: 'Git was not found. Use a local official SDK archive path for no-Git setup.',
    });
    return undefined;
  }

  const cacheDir = resolveYjkApiCacheDir(branch);
  const repoDir = path.join(cacheDir, 'repo');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

  if (fs.existsSync(path.join(repoDir, '.git'))) {
    const originUrl = runOptionalCommand(gitCommand, ['remote', 'get-url', 'origin'], repoDir, 10000);
    if (originUrl !== repoUrl) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } else {
      runRequiredCommand(gitCommand, ['fetch', '--depth', '1', 'origin', branch], repoDir);
      runRequiredCommand(gitCommand, ['checkout', branch], repoDir);
      runRequiredCommand(gitCommand, ['reset', '--hard', `origin/${branch}`], repoDir);
      steps.push({
        name: 'Update YJKAPI public repository cache',
        status: 'applied',
        details: `${repoUrl}#${branch}`,
      });
      return repoDir;
    }
  }

  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  runRequiredCommand(gitCommand, ['clone', '--depth', '1', '--branch', branch, repoUrl, repoDir]);
  steps.push({
    name: 'Clone YJKAPI public repository',
    status: 'applied',
    details: `${repoUrl}#${branch}`,
  });
  return repoDir;
}

function resolveYjkSdkSourceFromPublicRepo(steps: YjkAutoConfigureStep[]): string | undefined {
  const branch = yjkApiBranch();
  const repoDir = syncYjkApiPublicRepo(steps);
  if (!repoDir) return undefined;

  const archivePath = path.join(repoDir, 'SDK', `${branch}.rar`);
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    throw new Error(`YJKAPI SDK archive was not found in public repository cache: ${archivePath}`);
  }

  const extractedDir = path.join(resolveYjkApiCacheDir(branch), `sdk-${safeCacheSegment(branch)}`);
  fs.rmSync(extractedDir, { recursive: true, force: true });
  fs.mkdirSync(extractedDir, { recursive: true, mode: 0o700 });

  const extractor = findRarExtractor();
  runRequiredCommand(extractor.command, extractor.args(archivePath, extractedDir));

  const entries = fs.readdirSync(extractedDir);
  if (entries.length === 0) {
    throw new Error(`YJKAPI SDK archive extracted no files: ${archivePath}`);
  }

  const sdkRoot = entries.length === 1 && entries[0] === branch
    && fs.statSync(path.join(extractedDir, branch)).isDirectory()
    ? path.join(extractedDir, branch)
    : extractedDir;

  steps.push({
    name: 'Extract YJKAPI SDK archive',
    status: 'applied',
    details: `${archivePath} -> ${sdkRoot}`,
  });

  return sdkRoot;
}

function extractYjkSdkArchive(archivePath: string, branch: string, steps: YjkAutoConfigureStep[]): string {
  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive) || !fs.statSync(resolvedArchive).isFile()) {
    throw new Error(`YJKAPI SDK archive does not exist: ${resolvedArchive}`);
  }

  const extractedDir = path.join(resolveYjkApiCacheDir(branch), `sdk-${safeCacheSegment(branch)}-local`);
  fs.rmSync(extractedDir, { recursive: true, force: true });
  fs.mkdirSync(extractedDir, { recursive: true, mode: 0o700 });

  const extractor = findRarExtractor();
  runRequiredCommand(extractor.command, extractor.args(resolvedArchive, extractedDir));

  const entries = fs.readdirSync(extractedDir);
  if (entries.length === 0) {
    throw new Error(`YJKAPI SDK archive extracted no files: ${resolvedArchive}`);
  }

  const sdkRoot = entries.length === 1 && entries[0] === branch
    && fs.statSync(path.join(extractedDir, branch)).isDirectory()
    ? path.join(extractedDir, branch)
    : extractedDir;

  steps.push({
    name: 'Extract local YJKAPI SDK archive',
    status: 'applied',
    details: `${resolvedArchive} -> ${sdkRoot}`,
  });

  return sdkRoot;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const normalized = path.resolve(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveYjkInstallRoot(input: SettingsFileYjk | undefined, current: SettingsFile): string {
  const explicitRoot = input?.installRoot?.trim() || current.yjk?.installRoot?.trim();
  if (explicitRoot) {
    const resolved = path.resolve(explicitRoot);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`YJK install root does not exist: ${resolved}`);
    }
    return resolved;
  }

  const explicitExe = input?.exePath?.trim() || current.yjk?.exePath?.trim();
  if (explicitExe) {
    const resolvedExe = path.resolve(explicitExe);
    if (!fs.existsSync(resolvedExe) || !fs.statSync(resolvedExe).isFile()) {
      throw new Error(`yjks.exe path does not exist: ${resolvedExe}`);
    }
    return path.dirname(resolvedExe);
  }

  const candidates = uniqueStrings([
    process.env.YJK_PATH,
    process.env.YJKS_ROOT,
    'C:\\YJKS\\YJKS_8_0_0',
    'D:\\YJKS\\YJKS_8_0_0',
  ]);
  const detected = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (!detected) {
    throw new Error('YJK install root was not provided and no default YJK 8.0 directory was found.');
  }
  return detected;
}

function autoConfigureYjk(input: YjkAutoConfigureInput): { settings: SettingsResponse; steps: YjkAutoConfigureStep[] } {
  const current = readSettingsFile() ?? {};
  const requestedYjk = input.yjk;
  const steps: YjkAutoConfigureStep[] = [];

  const installRoot = resolveYjkInstallRoot(requestedYjk, current);
  steps.push({ name: 'Resolve YJK install root', status: 'applied', details: installRoot });
  assertYjkInstallNotRunning(installRoot);

  const requestedExe = requestedYjk?.exePath?.trim();
  const currentExe = current.yjk?.exePath?.trim();
  const exePath = requestedExe
    || (currentExe && fs.existsSync(currentExe) && fs.statSync(currentExe).isFile() ? currentExe : undefined)
    || findYjkExe(installRoot);
  if (!exePath || !fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
    throw new Error(`yjks.exe was not found under YJK install root: ${installRoot}`);
  }
  steps.push({ name: 'Resolve yjks.exe', status: 'applied', details: exePath });

  const requestedPython = requestedYjk?.pythonBin?.trim();
  const currentPython = current.yjk?.pythonBin?.trim();
  const pythonBin = requestedPython
    || (currentPython && fs.existsSync(currentPython) && fs.statSync(currentPython).isFile() ? currentPython : undefined)
    || findYjkPython(installRoot);
  if (!pythonBin || !fs.existsSync(pythonBin) || !fs.statSync(pythonBin).isFile()) {
    throw new Error(`YJK Python 3.10 was not found under YJK install root: ${installRoot}`);
  }
  steps.push({ name: 'Resolve YJK Python', status: 'applied', details: pythonBin });

  const yjk: SettingsFileYjk = {
    ...(current.yjk ?? {}),
    ...(requestedYjk ?? {}),
    installRoot,
    exePath,
    pythonBin,
    sdkArchivePath: requestedYjk?.sdkArchivePath?.trim() || current.yjk?.sdkArchivePath?.trim(),
    workDir: requestedYjk?.workDir?.trim() || current.yjk?.workDir?.trim() || config.yjkWorkDir,
    version: requestedYjk?.version?.trim() || current.yjk?.version?.trim() || '8.0.0',
    timeoutS: requestedYjk?.timeoutS ?? current.yjk?.timeoutS ?? 600,
    invisible: requestedYjk?.invisible ?? current.yjk?.invisible ?? false,
    launcherPrewarm: requestedYjk?.launcherPrewarm ?? current.yjk?.launcherPrewarm ?? 'auto',
    launcherPrewarmS: requestedYjk?.launcherPrewarmS ?? current.yjk?.launcherPrewarmS ?? 18,
    directReadyTimeoutS: requestedYjk?.directReadyTimeoutS ?? current.yjk?.directReadyTimeoutS ?? 12,
  };

  const sdkSource = resolveYjkSdkSourceFromPublicRepo(steps);
  const fallbackArchive = yjk.sdkArchivePath;
  const resolvedSdkSource = sdkSource
    ?? (fallbackArchive ? extractYjkSdkArchive(fallbackArchive, yjkApiBranch(), steps) : undefined);
  if (!resolvedSdkSource) {
    throw new Error(
      'YJKAPI SDK could not be prepared. Install Git for automatic Gitee setup, '
      + 'or download SDK/8.0.rar from the official Gitee repository and set YJK SDK Archive Path.',
    );
  }

  const copiedEntries = copyYjkSdkIntoInstallRoot(resolvedSdkSource, installRoot);
  steps.push({
    name: 'Copy YJKAPI SDK files',
    status: 'applied',
    details: `${copiedEntries} top-level entries copied from ${resolvedSdkSource}`,
  });

  writeSettingsFile({ ...current, yjk });
  steps.push({ name: 'Save StructureClaw YJK settings', status: 'applied' });

  return { settings: buildSettingsResponse(), steps };
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

  fastify.post('/yjk/auto-configure', {
    schema: {
      tags: ['Admin'],
      summary: 'Auto-configure local YJK runtime settings',
    },
  }, async (
    request: FastifyRequest<{ Body: YjkAutoConfigureInput }>,
    reply: FastifyReply,
  ) => {
    try {
      const parsed = yjkAutoConfigureSchema.parse(request.body ?? {});
      const result = autoConfigureYjk(parsed);
      return {
        success: true,
        steps: result.steps,
        settings: result.settings,
      };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        message: error instanceof Error ? error.message : 'YJK auto configuration failed.',
      });
    }
  });
}
