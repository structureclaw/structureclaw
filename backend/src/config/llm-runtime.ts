/**
 * LLM runtime settings — reads/writes LLM overrides from the unified
 * settings.json file.  Falls back to LLM_MODEL / LLM_BASE_URL env vars,
 * then to hardcoded defaults.
 *
 * Public API unchanged: getEffectiveLlmSettings / getPublicLlmSettings /
 * updateRuntimeLlmSettings / clearRuntimeLlmSettings.
 */
import { config } from './index.js';
import {
  normalizeOptionalString,
  readSettingsFile,
  readSettingsFileForUpdate,
  writeSettingsFile,
  type SettingsFileLlm,
} from './settings-file.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StoredLlmSettings = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type EffectiveLlmSettings = Pick<
  typeof config,
  'llmApiKey' | 'llmModel' | 'llmBaseUrl' | 'llmTimeoutMs' | 'llmMaxRetries'
>;

export type LlmValueSource = 'runtime' | 'default';
export type ApiKeySource = 'runtime' | 'env' | 'unset';
export type VisionValueSource = 'runtime' | 'env' | 'llm' | 'default' | 'unset';

export type PublicLlmSettings = {
  baseUrl: string;
  model: string;
  defaultBaseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasOverrides: boolean;
  baseUrlSource: LlmValueSource;
  modelSource: LlmValueSource;
  apiKeySource: ApiKeySource;
};

export type PublicVisionLlmSettings = {
  baseUrl: string;
  model: string;
  defaultBaseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasOverrides: boolean;
  baseUrlSource: VisionValueSource;
  modelSource: VisionValueSource;
  apiKeySource: VisionValueSource;
};

export type UpdateRuntimeLlmSettingsInput = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyMode?: 'keep' | 'replace' | 'inherit';
};

export type UpdateRuntimeVisionLlmSettingsInput = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyMode?: 'keep' | 'replace' | 'inherit';
};

// ---------------------------------------------------------------------------
// Hardcoded defaults (used for comparison when storing settings)
// ---------------------------------------------------------------------------

const LLM_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4-turbo-preview',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(apiKey: string | undefined): string {
  return apiKey ? '********' : '';
}

function getRuntimeLlmSettings(): StoredLlmSettings | null {
  const file = readSettingsFile();
  return file?.llm ?? null;
}

function getRuntimeVisionLlmSettings(): StoredLlmSettings | null {
  const file = readSettingsFile();
  return file?.vision ?? null;
}

function optionalEnvString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function optionalEnvNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getEffectiveLlmSettings(): EffectiveLlmSettings {
  const runtimeSettings = getRuntimeLlmSettings();
  return {
    llmApiKey: runtimeSettings?.apiKey || process.env.LLM_API_KEY || '',
    llmModel: runtimeSettings?.model || process.env.LLM_MODEL || LLM_DEFAULTS.model,
    llmBaseUrl: runtimeSettings?.baseUrl || process.env.LLM_BASE_URL || LLM_DEFAULTS.baseUrl,
    llmTimeoutMs: runtimeSettings?.timeoutMs ?? config.llmTimeoutMs,
    llmMaxRetries: runtimeSettings?.maxRetries ?? config.llmMaxRetries,
  };
}

export function getEffectiveVisionLlmSettings(): EffectiveLlmSettings | null {
  const visionSettings = getRuntimeVisionLlmSettings();
  const llmSettings = getRuntimeLlmSettings();
  const inheritedLlm = getEffectiveLlmSettings();
  const visionModel = visionSettings?.model || optionalEnvString('LLM_VISION_MODEL');
  if (!visionModel) return null;

  return {
    llmApiKey: visionSettings?.apiKey
      || optionalEnvString('LLM_VISION_API_KEY')
      || llmSettings?.apiKey
      || process.env.LLM_API_KEY
      || '',
    llmModel: visionModel,
    llmBaseUrl: visionSettings?.baseUrl
      || optionalEnvString('LLM_VISION_BASE_URL')
      || llmSettings?.baseUrl
      || process.env.LLM_BASE_URL
      || LLM_DEFAULTS.baseUrl,
    llmTimeoutMs: visionSettings?.timeoutMs
      ?? optionalEnvNumber('LLM_VISION_TIMEOUT_MS')
      ?? inheritedLlm.llmTimeoutMs,
    llmMaxRetries: visionSettings?.maxRetries
      ?? optionalEnvNumber('LLM_VISION_MAX_RETRIES')
      ?? inheritedLlm.llmMaxRetries,
  };
}

export function getPublicLlmSettings(): PublicLlmSettings {
  const runtimeSettings = getRuntimeLlmSettings();
  const effective = getEffectiveLlmSettings();
  const hasApiKey = effective.llmApiKey.trim().length > 0;
  const hasBaseUrlOverride = runtimeSettings?.baseUrl !== undefined;
  const hasModelOverride = runtimeSettings?.model !== undefined;
  const hasApiKeyOverride = runtimeSettings?.apiKey !== undefined && runtimeSettings.apiKey.trim().length > 0;
  const hasEnvApiKey = process.env.LLM_API_KEY !== undefined && process.env.LLM_API_KEY.trim().length > 0;
  const apiKeySource: ApiKeySource = hasApiKeyOverride ? 'runtime' : hasEnvApiKey ? 'env' : 'unset';

  return {
    baseUrl: effective.llmBaseUrl,
    model: effective.llmModel,
    defaultBaseUrl: LLM_DEFAULTS.baseUrl,
    defaultModel: LLM_DEFAULTS.model,
    hasApiKey,
    apiKeyMasked: maskApiKey(hasApiKey ? effective.llmApiKey : undefined),
    hasOverrides: hasBaseUrlOverride || hasModelOverride || hasApiKeyOverride,
    baseUrlSource: hasBaseUrlOverride ? 'runtime' : 'default',
    modelSource: hasModelOverride ? 'runtime' : 'default',
    apiKeySource,
  };
}

export function getPublicVisionLlmSettings(): PublicVisionLlmSettings {
  const visionSettings = getRuntimeVisionLlmSettings();
  const llmSettings = getRuntimeLlmSettings();
  const envVisionBaseUrl = optionalEnvString('LLM_VISION_BASE_URL');
  const envVisionModel = optionalEnvString('LLM_VISION_MODEL');
  const envVisionApiKey = optionalEnvString('LLM_VISION_API_KEY');
  const inheritedApiKey = llmSettings?.apiKey || process.env.LLM_API_KEY || '';
  const inheritedBaseUrl = llmSettings?.baseUrl || process.env.LLM_BASE_URL || LLM_DEFAULTS.baseUrl;
  const effective = getEffectiveVisionLlmSettings();
  const visibleApiKey = effective?.llmApiKey
    || visionSettings?.apiKey
    || envVisionApiKey
    || inheritedApiKey;

  const modelSource: VisionValueSource = visionSettings?.model
    ? 'runtime'
    : envVisionModel
      ? 'env'
      : 'unset';
  const baseUrlSource: VisionValueSource = visionSettings?.baseUrl
    ? 'runtime'
    : envVisionBaseUrl
      ? 'env'
      : inheritedBaseUrl
        ? (llmSettings?.baseUrl || process.env.LLM_BASE_URL ? 'llm' : 'default')
        : 'unset';
  const apiKeySource: VisionValueSource = visionSettings?.apiKey
    ? 'runtime'
    : envVisionApiKey
      ? 'env'
      : inheritedApiKey
        ? 'llm'
        : 'unset';
  const hasOverrides = !!(
    visionSettings?.baseUrl
    || visionSettings?.model
    || visionSettings?.apiKey
    || visionSettings?.timeoutMs !== undefined
    || visionSettings?.maxRetries !== undefined
  );

  return {
    baseUrl: effective?.llmBaseUrl ?? inheritedBaseUrl,
    model: effective?.llmModel ?? '',
    defaultBaseUrl: inheritedBaseUrl,
    defaultModel: '',
    hasApiKey: !!visibleApiKey.trim(),
    apiKeyMasked: maskApiKey(visibleApiKey.trim() ? visibleApiKey : undefined),
    hasOverrides,
    baseUrlSource,
    modelSource,
    apiKeySource,
  };
}

export function updateRuntimeLlmSettings(input: UpdateRuntimeLlmSettingsInput): PublicLlmSettings {
  const currentFull = readSettingsFileForUpdate();
  const existingSettings = currentFull.llm ?? null;
  const nextBaseUrl = input.baseUrl.trim();
  const nextModel = input.model.trim();

  let nextApiKey = existingSettings?.apiKey;
  const apiKeyMode = input.apiKeyMode || 'keep';

  if (apiKeyMode === 'inherit') {
    nextApiKey = undefined;
  } else if (apiKeyMode === 'replace') {
    nextApiKey = normalizeOptionalString(input.apiKey);
  }

  const llm: SettingsFileLlm = {
    baseUrl: nextBaseUrl !== LLM_DEFAULTS.baseUrl ? nextBaseUrl : undefined,
    model: nextModel !== LLM_DEFAULTS.model ? nextModel : undefined,
    apiKey: nextApiKey,
  };

  writeSettingsFile({ ...currentFull, llm });

  return getPublicLlmSettings();
}

export function clearRuntimeLlmSettings(): PublicLlmSettings {
  const currentFull = readSettingsFileForUpdate();
  writeSettingsFile({ ...currentFull, llm: {} });
  return getPublicLlmSettings();
}

export function updateRuntimeVisionLlmSettings(input: UpdateRuntimeVisionLlmSettingsInput): PublicVisionLlmSettings {
  const currentFull = readSettingsFileForUpdate();
  const existingSettings = currentFull.vision ?? null;
  const nextBaseUrl = input.baseUrl === undefined
    ? existingSettings?.baseUrl
    : input.baseUrl.trim();
  const nextModel = input.model === undefined
    ? existingSettings?.model
    : input.model.trim();

  let nextApiKey = existingSettings?.apiKey;
  const apiKeyMode = input.apiKeyMode || 'keep';

  if (apiKeyMode === 'inherit') {
    nextApiKey = undefined;
  } else if (apiKeyMode === 'replace') {
    nextApiKey = normalizeOptionalString(input.apiKey);
  }

  const vision: SettingsFileLlm = {
    baseUrl: nextBaseUrl || undefined,
    model: nextModel || undefined,
    apiKey: nextApiKey,
  };

  writeSettingsFile({ ...currentFull, vision });

  return getPublicVisionLlmSettings();
}

export function clearRuntimeVisionLlmSettings(): PublicVisionLlmSettings {
  const currentFull = readSettingsFileForUpdate();
  writeSettingsFile({ ...currentFull, vision: {} });
  return getPublicVisionLlmSettings();
}
