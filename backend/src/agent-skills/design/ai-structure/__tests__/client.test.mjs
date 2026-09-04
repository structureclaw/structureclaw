import { afterEach, describe, expect, test } from '@jest/globals';
import {
  AiStructureClientError,
  parseAiStructureResponse,
  requestAiStructureDesign,
  toAiStructureFailingMembers,
} from '../../../../../dist/agent-skills/design/ai-structure/client.js';

const baseSettings = {
  enabled: true,
  baseUrl: 'https://ai-structure.example.com',
  apiKey: 'test-key',
  endpointPath: '/api/v1/design/optimize',
  timeoutMs: 2000,
  maxRetries: 1,
};

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetchOnce(implementations) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const impl = implementations[Math.min(calls.length - 1, implementations.length - 1)];
    return impl(url, init);
  };
  return calls;
}

describe('ai-structure response parsing', () => {
  test('accepts H and rectangular suggestions with an optional cost', () => {
    const parsed = parseAiStructureResponse({
      suggestions: [
        { sectionId: '1', sectionName: 'HW250X250', shape: { kind: 'H', H: 250, B: 250, tw: 9, tf: 14 } },
        { sectionId: '2', shape: { kind: 'rectangular', H: 600, B: 600 } },
      ],
      cost: { amount: 0.5, currency: 'CNY' },
    });
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.suggestions[0]).toMatchObject({ sectionId: '1', sectionName: 'HW250X250', shape: { kind: 'H', tw: 9, tf: 14 } });
    expect(parsed.suggestions[1].shape).toEqual({ kind: 'rectangular', H: 600, B: 600 });
    expect(parsed.cost).toEqual({ amount: 0.5, currency: 'CNY' });
  });

  test('rejects payloads without a suggestions array', () => {
    expect(() => parseAiStructureResponse({ sections: [] })).toThrow(AiStructureClientError);
    expect(() => parseAiStructureResponse(null)).toThrow(AiStructureClientError);
  });

  test('rejects suggestions with missing or unsupported shapes', () => {
    expect(() => parseAiStructureResponse({ suggestions: [{ shape: { kind: 'H', H: 250, B: 250, tw: 9 } }] }))
      .toThrow(/sectionId/);
    expect(() => parseAiStructureResponse({ suggestions: [{ sectionId: '1', shape: { kind: 'H', H: 250, B: 250, tw: 9 } }] }))
      .toThrow(/tw\/tf/);
    expect(() => parseAiStructureResponse({ suggestions: [{ sectionId: '1', shape: { kind: 'circle', H: 250, B: 250 } }] }))
      .toThrow(/unsupported shape/);
    expect(() => parseAiStructureResponse({ suggestions: [{ sectionId: '1', shape: { kind: 'rectangular', H: -5, B: 600 } }] }))
      .toThrow(/unsupported shape/);
  });
});

describe('ai-structure failing member mapping', () => {
  test('maps element failures to section references and drops unmapped ones', () => {
    const mapping = new Map([['C1', '1']]);
    const members = toAiStructureFailingMembers([
      { elementId: 'C1', utilization: 1.25, clause: '7.1.1', item: 'strength' },
      { elementId: 'CX', utilization: 2.0 },
    ], mapping);
    expect(members).toHaveLength(1);
    expect(members[0]).toEqual({
      elementId: 'C1', sectionId: '1', utilization: 1.25, clause: '7.1.1', item: 'strength',
    });
  });
});

describe('ai-structure HTTP client', () => {
  const request = {
    iteration: 1,
    maxIterations: 10,
    model: { schema_version: '2.0.0' },
    failingMembers: [{ elementId: 'C1', sectionId: '1', utilization: 1.25 }],
  };
  const goodPayload = {
    suggestions: [{ sectionId: '1', shape: { kind: 'H', H: 250, B: 250, tw: 9, tf: 14 } }],
  };

  test('posts the design request with bearer auth and parses the response', async () => {
    const calls = mockFetchOnce([() => ({
      ok: true,
      status: 200,
      json: async () => goodPayload,
    })]);
    const response = await requestAiStructureDesign(baseSettings, request);
    expect(response.suggestions).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ai-structure.example.com/api/v1/design/optimize');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ iteration: 1, maxIterations: 10, failingMembers: request.failingMembers });
  });

  test('omits the Authorization header when no API key is configured', async () => {
    const calls = mockFetchOnce([() => ({ ok: true, status: 200, json: async () => goodPayload })]);
    await requestAiStructureDesign({ ...baseSettings, apiKey: undefined }, request);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });

  test('fails fast on non-retryable client errors', async () => {
    const calls = mockFetchOnce([() => ({ ok: false, status: 401, json: async () => ({}) })]);
    await expect(requestAiStructureDesign(baseSettings, request)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 401,
    });
    expect(calls).toHaveLength(1);
  });

  test('retries retryable server errors before failing', async () => {
    const calls = mockFetchOnce([
      () => ({ ok: false, status: 503, json: async () => ({}) }),
      () => ({ ok: false, status: 503, json: async () => ({}) }),
    ]);
    await expect(requestAiStructureDesign(baseSettings, request)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503,
    });
    expect(calls).toHaveLength(2); // initial attempt + 1 retry
  });

  test('survives a 200 response with an off-schema body as INVALID_RESPONSE', async () => {
    mockFetchOnce([() => ({ ok: true, status: 200, json: async () => ({ answer: 42 }) })]);
    await expect(requestAiStructureDesign(baseSettings, request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
