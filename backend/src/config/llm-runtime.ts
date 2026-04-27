/**
 * LLM runtime settings — reads/writes LLM overrides from the unified
 * settings.json file.  No env fallback; all config goes through settings.json
 * or hardcoded defaults.
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
export type ApiKeySource = 'runtime' | 'unset';

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
// Hardcoded defaults (used for comparison when storing settings)
// ---------------------------------------------------------------------------

const LLM_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4-turbo-preview',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  return {
    llmApiKey: runtimeSettings?.apiKey ?? '',
    llmModel: runtimeSettings?.model ?? LLM_DEFAULTS.model,
    llmBaseUrl: runtimeSettings?.baseUrl ?? LLM_DEFAULTS.baseUrl,
    llmTimeoutMs: runtimeSettings?.timeoutMs ?? config.llmTimeoutMs,
    llmMaxRetries: runtimeSettings?.maxRetries ?? config.llmMaxRetries,
  };
}

export function getPublicLlmSettings(): PublicLlmSettings {
  const runtimeSettings = getRuntimeLlmSettings();
  const effective = getEffectiveLlmSettings();
  const hasApiKey = effective.llmApiKey.trim().length > 0;
  const hasBaseUrlOverride = runtimeSettings?.baseUrl !== undefined;
  const hasModelOverride = runtimeSettings?.model !== undefined;
  const hasApiKeyOverride = runtimeSettings?.apiKey !== undefined && runtimeSettings.apiKey.trim().length > 0;

  return {
    baseUrl: effective.llmBaseUrl,
    model: effective.llmModel,
    hasApiKey,
    apiKeyMasked: maskApiKey(hasApiKey ? effective.llmApiKey : undefined),
    hasOverrides: hasBaseUrlOverride || hasModelOverride || hasApiKeyOverride,
    baseUrlSource: hasBaseUrlOverride ? 'runtime' : 'default',
    modelSource: hasModelOverride ? 'runtime' : 'default',
    apiKeySource: hasApiKey ? 'runtime' : 'unset',
  };
}

export function updateRuntimeLlmSettings(input: UpdateRuntimeLlmSettingsInput): PublicLlmSettings {
  const existingSettings = getRuntimeLlmSettings();
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
