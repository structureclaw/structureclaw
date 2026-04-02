import type { Route } from '@playwright/test';

/**
 * Build a mock SSE response body that mimics the backend chat stream.
 */
export function buildSSEChunks(payloads: Array<{ type: string; data?: unknown }>): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

/**
 * A realistic chat stream response for a structural analysis request.
 */
export function mockChatStreamResponse(): string {
  return buildSSEChunks([
    { type: 'start', data: { conversationId: 'conv-e2e-1' } },
    { type: 'token', data: { content: 'I will analyze' } },
    { type: 'token', data: { content: ' this beam structure.' } },
    {
      type: 'result',
      data: {
        model: {
          schema_version: 1,
          dimension: 2,
          nodes: [
            { id: 1, x: 0, y: 0, z: 0 },
            { id: 2, x: 6, y: 0, z: 0 },
          ],
          elements: [{ id: 1, type: 'beam', nodes: [1, 2], section: 'W200x100' }],
          loadCases: [{ id: 'dead', loads: [{ element: 1, type: 'distributed', wy: -10 }] }],
          supports: [{ node: 1, type: 'fixed' }, { node: 2, type: 'pinned' }],
        },
        analysis: {
          status: 'completed',
          engine: 'mock-e2e',
          cases: [
            {
              name: 'dead',
              nodes: [
                { id: 1, dx: 0, dy: 0, rz: 0 },
                { id: 2, dx: 0, dy: -0.003, rz: 0 },
              ],
              elements: [{ id: 1, axial: 0, shear: 5, moment: 15 }],
            },
          ],
        },
      },
    },
    { type: 'done' },
  ]);
}

/**
 * Intercept the chat stream endpoint with a mock response.
 */
export async function mockChatStream(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
    body: mockChatStreamResponse(),
  });
}
