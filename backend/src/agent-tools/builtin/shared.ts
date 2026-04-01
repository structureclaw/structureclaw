import type { LocalizedText } from '../../agent-runtime/types.js';

export function localize(zh: string, en: string): LocalizedText {
  return { zh, en };
}
