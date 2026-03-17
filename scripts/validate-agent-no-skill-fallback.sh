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

const hasDeterministicOutcome = (result) => {
  if (!result || typeof result !== 'object') {
    return false;
  }
  if (result.success === true || result.needsModelInput === true) {
    return true;
  }
  if (result.interaction && typeof result.interaction === 'object') {
    return true;
  }
  return typeof result.response === 'string' && result.response.trim().length > 0;
};

const run = async () => {
  process.env.LLM_API_KEY = process.env.LLM_API_KEY || '';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || '';

  const { AgentService } = await import('./backend/dist/services/agent.js');
  const svc = new AgentService();

  const chatResult = await svc.run({
    conversationId: 'conv-no-skill-chat',
    message: '先聊需求，我要算一个门式刚架',
    mode: 'chat',
    context: {
      skillIds: [],
      locale: 'zh',
    },
  });
  assert(hasDeterministicOutcome(chatResult), 'chat mode with empty skillIds should return deterministic outcome');

  const executeResult = await svc.run({
    conversationId: 'conv-no-skill-exec',
    message: '按3m悬臂梁端部10kN点荷载做静力分析',
    mode: 'execute',
    context: {
      skillIds: [],
      autoCodeCheck: false,
      includeReport: false,
      userDecision: 'allow_auto_decide',
      locale: 'zh',
    },
  });
  assert(hasDeterministicOutcome(executeResult), 'execute mode with empty skillIds should return deterministic outcome');

  const autoResult = await svc.run({
    conversationId: 'conv-no-skill-auto',
    message: '帮我做一个规则框架静力分析',
    mode: 'auto',
    context: {
      skillIds: [],
      locale: 'zh',
    },
  });
  assert(hasDeterministicOutcome(autoResult), 'auto mode with empty skillIds should return deterministic outcome');

  console.log('[ok] no-skill fallback contract');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
