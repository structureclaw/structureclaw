import fs from 'node:fs';
import path from 'node:path';
import { config } from './index.js';

type StoredLlmSettings = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  updatedAt?: string;
};

let cachedRuntimeLlmSettings: StoredLlmSettings | null | undefined;
let cachedRuntimeLlmSettingsPath: string | undefined;

export type EffectiveLlmSettings = Pick<
  typeof config,
  'llmApiKey' | 'llmModel' | 'llmBaseUrl' | 'llmTimeoutMs' | 'llmMaxRetries'
>;

export type LlmValueSource = 'runtime' | 'env';
export type ApiKeySource = LlmValueSource | 'unset';

export type PublicLlmSettings = {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasOverrides: boolean;
  baseUrlSource: LlmValueSource;
  modelSource: LlmValueSource;
  apiKeySource: ApiKeySource;
};

export type UpdateRuntimeLlmSettingsInput = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyMode?: 'keep' | 'replace' | 'inherit';
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getLlmSettingsPath(): string {
  return process.env.LLM_SETTINGS_PATH || config.llmSettingsPath;
}

function getEnvDefaults() {
  return {
    baseUrl: config.llmBaseUrl.trim(),
    model: config.llmModel.trim(),
    apiKey: config.llmApiKey.trim(),
  };
}

function normalizeStoredLlmSettings(value: unknown): StoredLlmSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    baseUrl: normalizeOptionalString(record.baseUrl),
    model: normalizeOptionalString(record.model),
    apiKey: normalizeOptionalString(record.apiKey),
    updatedAt: normalizeOptionalString(record.updatedAt),
  };
}

function readRuntimeLlmSettingsFromDisk(): StoredLlmSettings | null {
  const settingsPath = getLlmSettingsPath();

  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeStoredLlmSettings(parsed);
  } catch {
    return null;
  }
}

function setCachedRuntimeLlmSettings(settingsPath: string, settings: StoredLlmSettings | null) {
  cachedRuntimeLlmSettingsPath = settingsPath;
  cachedRuntimeLlmSettings = settings;
}

function hasStoredOverrides(settings: StoredLlmSettings | null | undefined): boolean {
  return Boolean(settings?.baseUrl || settings?.model || settings?.apiKey);
}

function writeRuntimeLlmSettingsToDisk(settings: StoredLlmSettings) {
  const settingsPath = getLlmSettingsPath();

  if (!hasStoredOverrides(settings)) {
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
    }
    setCachedRuntimeLlmSettings(settingsPath, null);
    return;
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  const nextSettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  setCachedRuntimeLlmSettings(settingsPath, nextSettings);
}

function getRuntimeLlmSettings(): StoredLlmSettings | null {
  const settingsPath = getLlmSettingsPath();

  if (cachedRuntimeLlmSettingsPath === settingsPath && cachedRuntimeLlmSettings !== undefined) {
    return cachedRuntimeLlmSettings;
  }

  const settings = readRuntimeLlmSettingsFromDisk();
  setCachedRuntimeLlmSettings(settingsPath, settings);
  return settings;
}

function maskApiKey(apiKey: string | undefined): string {
  return apiKey ? '********' : '';
}

export function getEffectiveLlmSettings(): EffectiveLlmSettings {
  const runtimeSettings = getRuntimeLlmSettings();

  return {
    llmApiKey: runtimeSettings?.apiKey ?? config.llmApiKey,
    llmModel: runtimeSettings?.model ?? config.llmModel,
    llmBaseUrl: runtimeSettings?.baseUrl ?? config.llmBaseUrl,
    llmTimeoutMs: config.llmTimeoutMs,
    llmMaxRetries: config.llmMaxRetries,
  };
}

export function hasConfiguredLlmApiKey(): boolean {
  return getEffectiveLlmSettings().llmApiKey.trim().length > 0;
}

export function getPublicLlmSettings(): PublicLlmSettings {
  const runtimeSettings = getRuntimeLlmSettings();
  const effectiveSettings = getEffectiveLlmSettings();
  const envDefaults = getEnvDefaults();
  const hasApiKey = effectiveSettings.llmApiKey.trim().length > 0;
  const hasBaseUrlOverride = runtimeSettings?.baseUrl !== undefined && runtimeSettings.baseUrl !== envDefaults.baseUrl;
  const hasModelOverride = runtimeSettings?.model !== undefined && runtimeSettings.model !== envDefaults.model;
  const hasApiKeyOverride = runtimeSettings?.apiKey !== undefined && runtimeSettings.apiKey !== envDefaults.apiKey;

  return {
    baseUrl: effectiveSettings.llmBaseUrl,
    model: effectiveSettings.llmModel,
    hasApiKey,
    apiKeyMasked: maskApiKey(hasApiKey ? effectiveSettings.llmApiKey : undefined),
    hasOverrides: hasBaseUrlOverride || hasModelOverride || hasApiKeyOverride,
    baseUrlSource: hasBaseUrlOverride ? 'runtime' : 'env',
    modelSource: hasModelOverride ? 'runtime' : 'env',
    apiKeySource: hasApiKeyOverride
      ? 'runtime'
      : envDefaults.apiKey
        ? 'env'
        : 'unset',
  };
}

export function updateRuntimeLlmSettings(input: UpdateRuntimeLlmSettingsInput): PublicLlmSettings {
  const existingSettings = getRuntimeLlmSettings();
  const envDefaults = getEnvDefaults();
  const nextBaseUrl = input.baseUrl.trim();
  const nextModel = input.model.trim();

  let nextApiKey = existingSettings?.apiKey;
  const apiKeyMode = input.apiKeyMode || 'keep';

  if (apiKeyMode === 'inherit') {
    nextApiKey = undefined;
  } else if (apiKeyMode === 'replace') {
    const normalizedApiKey = normalizeOptionalString(input.apiKey);
    nextApiKey = normalizedApiKey && normalizedApiKey !== envDefaults.apiKey
      ? normalizedApiKey
      : undefined;
  }

  const nextSettings: StoredLlmSettings = {
    baseUrl: nextBaseUrl !== envDefaults.baseUrl ? nextBaseUrl : undefined,
    model: nextModel !== envDefaults.model ? nextModel : undefined,
    apiKey: nextApiKey && nextApiKey !== envDefaults.apiKey ? nextApiKey : undefined,
  };

  writeRuntimeLlmSettingsToDisk(nextSettings);

  return getPublicLlmSettings();
}

export function clearRuntimeLlmSettings(): PublicLlmSettings {
  writeRuntimeLlmSettingsToDisk({});
  return getPublicLlmSettings();
}
