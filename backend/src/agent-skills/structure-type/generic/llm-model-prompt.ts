import type { AppLocale } from '../../../services/locale.js';
import type { DraftState } from '../../../agent-runtime/types.js';
import { composePromptByIntent } from './llm-model-prompt-intents.js';

const STATE_METADATA_KEYS = new Set([
  'skillId', 'supportLevel', 'supportNote', 'updatedAt', 'structuralTypeKey',
]);

function buildCleanStateHint(state: DraftState): string {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!STATE_METADATA_KEYS.has(key) && value !== undefined) {
      filtered[key] = value;
    }
  }
  return JSON.stringify(filtered);
}

export function buildGenericModelPrompt(
  message: string,
  state: DraftState,
  locale: AppLocale,
  conversationHistory?: string,
): string {
  const stateHint = buildCleanStateHint(state);
  return composePromptByIntent('build-structure-model-v1', locale, stateHint, message, conversationHistory);
}

export function buildRetrySuffix(locale: AppLocale): string {
  return locale === 'zh'
    ? '\n上一轮输出未通过 JSON 校验。请仅返回合法 JSON 对象。'
    : '\nThe previous output did not pass JSON validation. Return a valid JSON object only.';
}
