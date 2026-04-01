import type { AppLocale } from '../../../services/locale.js';
import type { DraftState } from '../../../agent-runtime/types.js';
import { composePromptByIntent } from './llm-model-prompt-intents.js';

export function buildGenericModelPrompt(message: string, state: DraftState, locale: AppLocale): string {
  const stateHint = JSON.stringify(state);
  return composePromptByIntent('build-structure-model-v1', locale, stateHint, message);
}

export function buildRetrySuffix(locale: AppLocale): string {
  return locale === 'zh'
    ? '\n上一轮输出未通过 JSON 校验。请仅返回合法 JSON 对象。'
    : '\nThe previous output did not pass JSON validation. Return a valid JSON object only.';
}