import type { AppLocale } from '../../../services/locale.js';
import { getCommonConstraints, getStructureModelTemplate } from './llm-model-prompt-fragments.js';

export type GenericModelPromptIntent = 'build-structure-model-v1';

type PromptIntentConfig = {
  opening: (locale: AppLocale) => string[];
  closing: (locale: AppLocale, stateHint: string, message: string, conversationHistory?: string) => string[];
};

const INTENT_CONFIGS: Record<GenericModelPromptIntent, PromptIntentConfig> = {
  'build-structure-model-v1': {
    opening: (locale) => {
      const template = getStructureModelTemplate();
      if (locale === 'zh') {
        return [
          '你是结构建模专家。',
          '请根据用户描述输出可计算的 StructureModel v1 JSON。',
          '只输出 JSON 对象，不要 Markdown。',
          '以下 1.0.0 JSON 模板是核心格式，请严格遵循键名与层级。',
          `模板:\n${template}`,
        ];
      }
      return [
        'You are a structural modeling expert.',
        'Generate a computable StructureModel v1 JSON from the user request.',
        'Return JSON object only, without markdown.',
        'The 1.0.0 JSON template below is the base format. Follow its keys and nesting strictly.',
        `Template:\n${template}`,
      ];
    },
    closing: (locale, stateHint, message, conversationHistory) => {
      const lines: string[] = [];
      if (conversationHistory) {
        lines.push(locale === 'zh' ? `对话历史:\n${conversationHistory}` : `Conversation history:\n${conversationHistory}`);
      }
      if (locale === 'zh') {
        lines.push(`已确认参数: ${stateHint}`);
        lines.push(`用户最新输入: ${message}`);
      } else {
        lines.push(`Confirmed parameters: ${stateHint}`);
        lines.push(`Latest user message: ${message}`);
      }
      return lines;
    },
  },
};

export function composePromptByIntent(
  intent: GenericModelPromptIntent,
  locale: AppLocale,
  stateHint: string,
  message: string,
  conversationHistory?: string,
): string {
  const config = INTENT_CONFIGS[intent];
  const opening = config.opening(locale);
  const constraints = getCommonConstraints(locale);
  const closing = config.closing(locale, stateHint, message, conversationHistory);
  return [...opening, ...constraints, ...closing].join('\n');
}
