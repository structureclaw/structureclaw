#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build --prefix backend >/dev/null

node - <<'JS'
const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const parseSseEvents = (raw) => raw
  .split('\n\n')
  .map((chunk) => chunk.trim())
  .filter(Boolean)
  .filter((chunk) => chunk.startsWith('data: '))
  .map((chunk) => chunk.slice('data: '.length));

const run = async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(process.cwd() + '/backend/package.json');
  const Fastify = require('fastify');

  const { AgentService } = await import('./backend/dist/services/agent.js');
  let capturedTraceId;
  AgentService.prototype.runStream = async function *mockRunStream(params) {
    capturedTraceId = params.traceId;
    const traceId = 'stream-trace-001';
    yield { type: 'start', content: { traceId, mode: 'execute', startedAt: '2026-03-09T00:00:00.000Z' } };
    yield {
      type: 'result',
      content: {
        traceId,
        startedAt: '2026-03-09T00:00:00.000Z',
        completedAt: '2026-03-09T00:00:00.008Z',
        durationMs: 8,
        success: true,
        mode: 'rule-based',
        needsModelInput: false,
        plan: ['validate', 'analyze', 'report'],
        toolCalls: [],
        response: 'ok',
      },
    };
    yield { type: 'done' };
  };

  const { chatRoutes } = await import('./backend/dist/api/chat.js');
  const app = Fastify();
  await app.register(chatRoutes, { prefix: '/api/v1/chat' });

  const resp = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/stream',
    headers: {
      origin: 'http://localhost:30000',
    },
    payload: {
      message: 'stream contract test',
      mode: 'execute',
      traceId: 'trace-stream-request-1',
      context: {
        model: { schema_version: '1.0.0' },
      },
    },
  });

  assert(resp.statusCode === 200, 'chat/stream should return 200');
  assert(
    resp.headers['access-control-allow-origin'] === 'http://localhost:30000',
    'chat/stream should include access-control-allow-origin for allowed origin'
  );
  assert(
    resp.headers['access-control-allow-credentials'] === 'true',
    'chat/stream should include access-control-allow-credentials for allowed origin'
  );
  assert(
    String(resp.headers.vary || '').includes('Origin'),
    'chat/stream should include Vary: Origin for allowed origin'
  );
  const events = parseSseEvents(resp.body);
  assert(events.length >= 4, 'stream should include events and done marker');
  assert(events[events.length - 1] === '[DONE]', 'stream should end with [DONE]');

  const chunks = events
    .filter((item) => item !== '[DONE]')
    .map((item) => JSON.parse(item));
  assert(chunks[0].type === 'start', 'first chunk should be start');
  assert(chunks.some((c) => c.type === 'result'), 'stream should contain result chunk');
  assert(chunks[chunks.length - 1].type === 'done', 'last chunk before [DONE] should be done');
  assert(capturedTraceId === 'trace-stream-request-1', 'chat/stream should pass traceId to agent stream');

  const startTrace = chunks.find((c) => c.type === 'start')?.content?.traceId;
  const resultTrace = chunks.find((c) => c.type === 'result')?.content?.traceId;
  assert(startTrace && resultTrace && startTrace === resultTrace, 'traceId should match between start and result');
  assert(typeof chunks.find((c) => c.type === 'start')?.content?.startedAt === 'string', 'start event should include startedAt');

  const disallowedResp = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/stream',
    headers: {
      origin: 'http://evil.example.com',
    },
    payload: {
      message: 'stream contract test',
      mode: 'execute',
      traceId: 'trace-stream-request-2',
      context: {
        model: { schema_version: '1.0.0' },
      },
    },
  });

  assert(
    disallowedResp.headers['access-control-allow-origin'] === undefined,
    'chat/stream should omit access-control-allow-origin for disallowed origin'
  );

  await app.close();
  console.log('[ok] chat stream contract regression');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
