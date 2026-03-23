#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${LLM_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" && -z "${ZAI_API_KEY:-}" ]]; then
  echo "[skip] no LLM key found (LLM_API_KEY/OPENAI_API_KEY/ZAI_API_KEY)"
  exit 0
fi

# online smoke should be bounded and fast
export LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-15000}"
export LLM_MAX_RETRIES="${LLM_MAX_RETRIES:-0}"

npm run build --prefix backend >/dev/null

node - <<'JS'
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const run = async () => {
  const { AgentService } = await import('./backend/dist/services/agent.js');
  const svc = new AgentService();

  // stub engine side only; keep LLM enabled to test online extraction/summary path
  svc.structureProtocolClient = {
    post: async (path) => {
      if (path === '/validate') return { data: { valid: true, schemaVersion: '1.0.0' } };
      throw new Error(`unexpected structure protocol path ${path}`);
    },
  };
  svc.engineClient.post = async (path, payload) => {
    if (path === '/analyze') {
      return {
        data: {
          schema_version: '1.0.0',
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: 'ok',
          data: {},
          meta: {},
        },
      };
    }
    throw new Error(`unexpected analysis path ${path}`);
  };

  const started = Date.now();
  const result = await svc.run({
    message: '请按一个3m悬臂梁，端部10kN竖向荷载做静力分析',
    mode: 'execute',
  });
  const elapsed = Date.now() - started;

  assert(result.mode === 'llm-assisted', 'online smoke should run in llm-assisted mode');
  assert(result.toolCalls.some((c) => c.tool === 'text-to-model-draft'), 'draft tool should be called');
  assert(result.toolCalls.some((c) => c.tool === 'analyze'), 'analyze should be called');
  assert(elapsed < 30000, `online smoke should finish within 30s, got ${elapsed}ms`);

  console.log(`[ok] agent online smoke elapsedMs=${elapsed}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
