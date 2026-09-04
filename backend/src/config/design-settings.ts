/**
 * Design-service runtime settings — resolves the Agent design-loop
 * configuration (max iterations + external ai-structure.com service) from
 * settings.json, falling back to DESIGN_* environment variables and then to
 * hardcoded defaults. Mirrors the llm-runtime.ts resolution pattern.
 *
 * ai-structure.com documents no public API; the default baseUrl/endpointPath
 * are best-effort assumptions and the service is disabled by default. The
 * built-in rule-based local design engine stays the working path.
 */
import {
  normalizeOptionalString,
  readSettingsFile,
  type SettingsFileDesignAiStructure,
} from './settings-file.js';
import type { AiStructureDesignSettings, DesignSettings } from '../agent-runtime/types.js';

export const DESIGN_DEFAULT_MAX_ITERATIONS = 10;
export const DESIGN_AI_STRUCTURE_DEFAULT_BASE_URL = 'https://ai-structure.com';
export const DESIGN_AI_STRUCTURE_DEFAULT_ENDPOINT_PATH = '/api/v1/design/optimize';
export const DESIGN_AI_STRUCTURE_DEFAULT_TIMEOUT_MS = 30_000;
export const DESIGN_AI_STRUCTURE_DEFAULT_MAX_RETRIES = 2;

function envBoolean(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
}

function resolveAiStructureSettings(
  fileSettings: SettingsFileDesignAiStructure | undefined,
): AiStructureDesignSettings {
  const enabled = fileSettings?.enabled ?? envBoolean('DESIGN_AI_STRUCTURE_ENABLED') ?? false;
  const baseUrl = normalizeOptionalString(fileSettings?.baseUrl)
    ?? normalizeOptionalString(process.env.DESIGN_AI_STRUCTURE_BASE_URL)
    ?? DESIGN_AI_STRUCTURE_DEFAULT_BASE_URL;
  const apiKey = normalizeOptionalString(fileSettings?.apiKey)
    ?? normalizeOptionalString(process.env.DESIGN_AI_STRUCTURE_API_KEY);
  const endpointPath = normalizeOptionalString(fileSettings?.endpointPath)
    ?? normalizeOptionalString(process.env.DESIGN_AI_STRUCTURE_ENDPOINT_PATH)
    ?? DESIGN_AI_STRUCTURE_DEFAULT_ENDPOINT_PATH;
  const timeoutMs = fileSettings?.timeoutMs
    ?? envNumber('DESIGN_AI_STRUCTURE_TIMEOUT_MS')
    ?? DESIGN_AI_STRUCTURE_DEFAULT_TIMEOUT_MS;
  const maxRetries = fileSettings?.maxRetries
    ?? envNumber('DESIGN_AI_STRUCTURE_MAX_RETRIES')
    ?? DESIGN_AI_STRUCTURE_DEFAULT_MAX_RETRIES;
  const estimatedCostPerCall = fileSettings?.estimatedCostPerCall
    ?? envNumber('DESIGN_AI_STRUCTURE_ESTIMATED_COST_PER_CALL');

  return {
    enabled,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    ...(apiKey !== undefined ? { apiKey } : {}),
    endpointPath: endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`,
    timeoutMs: timeoutMs > 0 ? timeoutMs : DESIGN_AI_STRUCTURE_DEFAULT_TIMEOUT_MS,
    maxRetries: Math.max(0, Math.floor(maxRetries)),
    ...(estimatedCostPerCall !== undefined && estimatedCostPerCall >= 0 ? { estimatedCostPerCall } : {}),
  };
}

/** Resolve the effective design-loop settings (settings.json → env → defaults). */
export function resolveDesignSettings(): DesignSettings {
  const fileDesign = readSettingsFile()?.design;
  const maxIterations = toPositiveInt(fileDesign?.maxIterations)
    ?? toPositiveInt(envNumber('DESIGN_MAX_ITERATIONS'))
    ?? DESIGN_DEFAULT_MAX_ITERATIONS;
  return {
    maxIterations,
    aiStructure: resolveAiStructureSettings(fileDesign?.aiStructure),
  };
}
