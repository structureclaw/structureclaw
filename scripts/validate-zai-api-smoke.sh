#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

export LLM_PROVIDER="${LLM_PROVIDER:-zhipu}"
export LLM_MODEL="${LLM_MODEL:-glm-4-plus}"
export LLM_BASE_URL="${LLM_BASE_URL:-https://open.bigmodel.cn/api/paas/v4/}"
export LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-15000}"
export LLM_MAX_RETRIES="${LLM_MAX_RETRIES:-0}"

if [[ -z "${LLM_API_KEY:-}" && -z "${ZAI_API_KEY:-}" ]]; then
  echo "[skip] no ZAI key found (LLM_API_KEY/ZAI_API_KEY)"
  exit 0
fi

npm run build --prefix backend >/dev/null

node - <<'JS'
const normalizeText = (content) => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object' && 'text' in part) {
          return String(part.text ?? '');
        }

        return '';
      })
      .join('');
  }

  return '';
};

const run = async () => {
  const { config } = await import('./backend/dist/config/index.js');
  const { createChatModel, llmProviderLabel } = await import('./backend/dist/utils/llm.js');

  if (config.llmProvider !== 'zhipu') {
    throw new Error(`expected zhipu provider but got ${config.llmProvider}`);
  }

  const model = createChatModel(0);
  if (!model) {
    throw new Error('createChatModel returned null; missing LLM key');
  }

  const started = Date.now();
  const response = await model.invoke([
    ['system', 'You are a health check endpoint. Reply with exactly: ZAI_OK'],
    ['user', 'Return the exact health-check token only.'],
  ]);
  const elapsed = Date.now() - started;
  const text = normalizeText(response.content).trim();

  if (!text.includes('ZAI_OK')) {
    throw new Error(`unexpected response content: ${JSON.stringify(text)}`);
  }

  console.log(`[ok] zai api smoke passed provider=${llmProviderLabel()} elapsedMs=${elapsed} content=${JSON.stringify(text)}`);
};

run().catch((error) => {
  console.error(`[fail] zai api smoke failed: ${error?.message || error}`);
  process.exit(1);
});
JS
