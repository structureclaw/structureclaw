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

const run = async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(process.cwd() + '/backend/package.json');
  const Fastify = require('fastify');

  const { AgentService } = await import('./backend/dist/services/agent.js');
  const { ChatService } = await import('./backend/dist/services/chat.js');

  let agentRunCount = 0;
  let chatSendCount = 0;
  const capturedTraceIds = [];

  AgentService.prototype.run = async function mockAgentRun(params) {
    agentRunCount += 1;
    capturedTraceIds.push(params.traceId);
    return {
      traceId: 'trace-route-001',
      startedAt: '2026-03-09T00:00:00.000Z',
      completedAt: '2026-03-09T00:00:00.006Z',
      durationMs: 6,
      success: true,
      mode: 'rule-based',
      needsModelInput: false,
      plan: ['validate', 'analyze'],
      toolCalls: [],
      response: 'execute-ok',
    };
  };

  ChatService.prototype.sendMessage = async function mockSendMessage() {
    chatSendCount += 1;
    return {
      conversationId: 'conv-route-001',
      response: 'chat-ok',
    };
  };

  const { chatRoutes } = await import('./backend/dist/api/chat.js');
  const app = Fastify();
  await app.register(chatRoutes, { prefix: '/api/v1/chat' });

  const autoChatResp = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/message',
    payload: {
      message: 'auto without model',
      mode: 'auto',
      context: {
        skillIds: ['beam'],
      },
    },
  });
  assert(autoChatResp.statusCode === 200, 'auto chat response should be 200');
  const autoChatPayload = autoChatResp.json();
  assert(autoChatPayload.mode === 'chat', 'auto without model should route to chat');
  assert(autoChatPayload.result?.response === 'chat-ok', 'chat result should be returned');

  const autoExecResp = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/message',
    payload: {
      message: 'auto with model',
      mode: 'auto',
      traceId: 'trace-route-auto-1',
      context: {
        model: { schema_version: '1.0.0' },
      },
    },
  });
  assert(autoExecResp.statusCode === 200, 'auto execute response should be 200');
  const autoExecPayload = autoExecResp.json();
  assert(autoExecPayload.mode === 'execute', 'auto with model should route to execute');
  assert(autoExecPayload.result?.traceId === 'trace-route-001', 'execute result should be returned');

  const autoIntentExecResp = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/message',
    payload: {
      message: '请帮我做结构设计验算',
      mode: 'auto',
      traceId: 'trace-route-auto-intent-1',
    },
  });
  assert(autoIntentExecResp.statusCode === 200, 'auto intent execute response should be 200');
  const autoIntentExecPayload = autoIntentExecResp.json();
  assert(autoIntentExecPayload.mode === 'execute', 'auto with design/check intent should route to execute');

  const forceExecResp = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/message',
    payload: {
      message: 'force execute',
      mode: 'execute',
      traceId: 'trace-route-exec-1',
    },
  });
  assert(forceExecResp.statusCode === 200, 'execute response should be 200');
  const forceExecPayload = forceExecResp.json();
  assert(forceExecPayload.mode === 'execute', 'mode=execute should route to execute');

  assert(agentRunCount === 3, 'agent run should be called three times');
  assert(capturedTraceIds.includes('trace-route-auto-1'), 'auto execute should pass traceId');
  assert(capturedTraceIds.includes('trace-route-auto-intent-1'), 'auto intent execute should pass traceId');
  assert(capturedTraceIds.includes('trace-route-exec-1'), 'forced execute should pass traceId');
  assert(chatSendCount === 1, 'chat send should be called once');

  await app.close();
  console.log('[ok] chat message routing contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
