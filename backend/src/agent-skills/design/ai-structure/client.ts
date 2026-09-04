/**
 * Best-effort REST adapter for the ai-structure.com design service
 * (AIstructure-Copilot cloud backend).
 *
 * VERIFIED API STATUS (researched 2026-09): ai-structure.com publishes no
 * public API documentation. Their product is a CAD plugin (AutoCAD/ZWCAD)
 * with a closed cloud backend; /docs, /api, /developer, /openapi return 404
 * and there is no public SDK. Consequently the transport below implements
 * only what the integration issue asks for (REST, API key auth header,
 * retry/backoff, timeout) and the request/response contracts are documented
 * ASSUMPTIONS, kept deliberately narrow:
 *
 *   POST {baseUrl}{endpointPath}
 *   Authorization: Bearer {apiKey}          (when an API key is configured)
 *   body:   AiStructureDesignRequest        (StructureClaw model + failing members)
 *   2xx:    { suggestions: [{ sectionId, sectionName?, shape }], cost? }
 *
 * Any non-2xx, timeout, or schema deviation throws AiStructureClientError —
 * callers must fall back to the rule-based local design engine. The service
 * is disabled by default (design.aiStructure.enabled=false).
 */
import type { AiStructureDesignSettings } from '../../../agent-runtime/types.js';
import type { MemberFailure } from '../provider.js';

export interface AiStructureRequestMember {
  elementId: string;
  sectionId: string;
  utilization: number;
  clause?: string;
  item?: string;
}

export interface AiStructureDesignRequest {
  iteration: number;
  maxIterations: number;
  /** StructureClaw normalized model passed through unchanged. */
  model: Record<string, unknown>;
  failingMembers: AiStructureRequestMember[];
}

export type AiStructureSuggestionShape =
  | { kind: 'H'; H: number; B: number; tw: number; tf: number }
  | { kind: 'rectangular'; H: number; B: number };

export interface AiStructureSectionSuggestion {
  sectionId: string;
  sectionName?: string;
  shape: AiStructureSuggestionShape;
}

export interface AiStructureDesignResponse {
  suggestions: AiStructureSectionSuggestion[];
  cost?: { amount?: number; currency?: string };
  raw: unknown;
}

export class AiStructureClientError extends Error {
  constructor(
    message: string,
    readonly code: 'TIMEOUT' | 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'NOT_CONFIGURED',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiStructureClientError';
  }
}

/** Build failing-member entries from code-check utilization signals. */
export function toAiStructureFailingMembers(
  failures: MemberFailure[],
  sectionIdByElement: Map<string, string>,
): AiStructureRequestMember[] {
  return failures
    .map((failure) => {
      const sectionId = sectionIdByElement.get(failure.elementId);
      if (!sectionId) return undefined;
      return {
        elementId: failure.elementId,
        sectionId,
        utilization: failure.utilization,
        ...(failure.clause !== undefined ? { clause: failure.clause } : {}),
        ...(failure.item !== undefined ? { item: failure.item } : {}),
      };
    })
    .filter((member): member is AiStructureRequestMember => member !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Strict response-schema validation — deviation is an error, not a guess. */
export function parseAiStructureResponse(payload: unknown): AiStructureDesignResponse {
  if (!isRecord(payload) || !Array.isArray(payload.suggestions)) {
    throw new AiStructureClientError(
      'ai-structure response did not contain a suggestions array',
      'INVALID_RESPONSE',
    );
  }
  const suggestions: AiStructureSectionSuggestion[] = [];
  for (const entry of payload.suggestions) {
    if (!isRecord(entry) || typeof entry.sectionId !== 'string') {
      throw new AiStructureClientError(
        'ai-structure suggestion is missing a string sectionId',
        'INVALID_RESPONSE',
      );
    }
    const shape = isRecord(entry.shape) ? entry.shape : undefined;
    const H = positiveNumber(shape?.H);
    const B = positiveNumber(shape?.B);
    const kind = shape?.kind === 'H' || shape?.kind === 'rectangular' ? shape.kind : undefined;
    if (!shape || !H || !B || !kind) {
      throw new AiStructureClientError(
        `ai-structure suggestion for section ${entry.sectionId} has an unsupported shape`,
        'INVALID_RESPONSE',
      );
    }
    if (kind === 'H') {
      const tw = positiveNumber(shape.tw);
      const tf = positiveNumber(shape.tf);
      if (!tw || !tf) {
        throw new AiStructureClientError(
          `ai-structure H-shape suggestion for section ${entry.sectionId} is missing tw/tf`,
          'INVALID_RESPONSE',
        );
      }
      suggestions.push({
        sectionId: entry.sectionId,
        ...(typeof entry.sectionName === 'string' ? { sectionName: entry.sectionName } : {}),
        shape: { kind, H, B, tw, tf },
      });
      continue;
    }
    suggestions.push({
      sectionId: entry.sectionId,
      ...(typeof entry.sectionName === 'string' ? { sectionName: entry.sectionName } : {}),
      shape: { kind, H, B },
    });
  }
  const costRecord = isRecord(payload.cost) ? payload.cost : undefined;
  const amount = typeof costRecord?.amount === 'number' && Number.isFinite(costRecord.amount)
    ? costRecord.amount
    : undefined;
  return {
    suggestions,
    ...(amount !== undefined
      ? { cost: { amount, ...(typeof costRecord?.currency === 'string' ? { currency: costRecord.currency } : {}) } }
      : {}),
    raw: payload,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

/**
 * POST the design request with retry/backoff and a hard timeout. Retries
 * cover network and 5xx failures; 4xx responses fail fast (auth/payload
 * problems will not heal).
 */
export async function requestAiStructureDesign(
  settings: AiStructureDesignSettings,
  request: AiStructureDesignRequest,
  signal?: AbortSignal,
): Promise<AiStructureDesignResponse> {
  if (!settings.baseUrl) {
    throw new AiStructureClientError('ai-structure baseUrl is not configured', 'NOT_CONFIGURED');
  }
  const url = `${settings.baseUrl.replace(/\/+$/, '')}${settings.endpointPath}`;
  const attempts = settings.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('aborted');
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new AiStructureClientError(
      `ai-structure request timed out after ${settings.timeoutMs}ms`,
      'TIMEOUT',
    )), settings.timeoutMs);
    const onAbort = () => timeout.abort(signal?.reason ?? new Error('aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify(request),
        signal: timeout.signal,
      });
      if (!response.ok) {
        throw new AiStructureClientError(
          `ai-structure request failed with HTTP ${response.status}`,
          'HTTP_ERROR',
          response.status,
        );
      }
      const payload: unknown = await response.json();
      return parseAiStructureResponse(payload);
    } catch (error) {
      lastError = error;
      // Non-retryable: client errors (except 429) and aborts from the caller.
      if (error instanceof AiStructureClientError && error.code === 'HTTP_ERROR'
        && error.status !== undefined && error.status < 500 && error.status !== 429) {
        throw error;
      }
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      if (attempt < attempts - 1) {
        await sleep(500 * 2 ** attempt, signal);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiStructureClientError('ai-structure request failed', 'HTTP_ERROR');
}
