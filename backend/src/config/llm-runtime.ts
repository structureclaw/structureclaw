/**
 * LLM runtime settings — reads/writes LLM overrides from the unified
 * settings.json file.  Falls back to .env defaults when no override exists.
 *
 * Public API unchanged: getEffectiveLlmSettings / getPublicLlmSettings /
 * updateRuntimeLlmSettings / clearRuntimeLlmSettings.
 */
import { config } from './index.js';
import {
  readSettingsFile,
  writeSettingsFile,
  type SettingsFileLlm,
} from './settings-file.js';

// ---------------------------------------------------------------------------
// Types (unchanged public API)
// ---------------------------------------------------------------------------

type StoredLlmSettings = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnvDefaults() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || '').trim() || config.llmBaseUrl,
    model: (process.env.LLM_MODEL || '').trim() || config.llmModel,
    apiKey: (process.env.LLM_API_KEY || '').trim(),
  };
}

function maskApiKey(apiKey: string | undefined): string {
  return apiKey ? '********' : '';
}

function getRuntimeLlmSettings(): StoredLlmSettings | null {
  const file = readSettingsFile();
  return file?.llm ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getEffectiveLlmSettings(): EffectiveLlmSettings {
  const runtimeSettings = getRuntimeLlmSettings();
  const envDefaults = getEnvDefaults();

  return {
    llmApiKey: runtimeSettings?.apiKey ?? envDefaults.apiKey,
    llmModel: runtimeSettings?.model ?? envDefaults.model,
    llmBaseUrl: runtimeSettings?.baseUrl ?? envDefaults.baseUrl,
    llmTimeoutMs: config.llmTimeoutMs,
    llmMaxRetries: config.llmMaxRetries,
  };
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

  const llm: SettingsFileLlm = {
    baseUrl: nextBaseUrl !== envDefaults.baseUrl ? nextBaseUrl : undefined,
    model: nextModel !== envDefaults.model ? nextModel : undefined,
    apiKey: nextApiKey && nextApiKey !== envDefaults.apiKey ? nextApiKey : undefined,
  };

  // Read current full settings, update llm section only
  const currentFull = readSettingsFile() ?? {};
  writeSettingsFile({ ...currentFull, llm });

  return getPublicLlmSettings();
}

export function clearRuntimeLlmSettings(): PublicLlmSettings {
  const currentFull = readSettingsFile() ?? {};
  writeSettingsFile({ ...currentFull, llm: {} });
  return getPublicLlmSettings();
}
