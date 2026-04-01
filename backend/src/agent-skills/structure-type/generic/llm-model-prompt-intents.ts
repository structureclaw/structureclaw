import type { AppLocale } from '../../../services/locale.js';
import { getCommonConstraints, getStructureModelTemplate } from './llm-model-prompt-fragments.js';

export type GenericModelPromptIntent = 'build-structure-model-v1';

type PromptIntentConfig = {
  opening: (locale: AppLocale) => string[];
  closing: (locale: AppLocale, stateHint: string, message: string) => string[];
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
    closing: (locale, stateHint, message) => {
      if (locale === 'zh') {
        return [
          `已有草模信息: ${stateHint}`,
          `用户输入: ${message}`,
        ];
      }
      return [
        `Current draft hints: ${stateHint}`,
        `User request: ${message}`,
      ];
    },
  },
};

export function composePromptByIntent(
  intent: GenericModelPromptIntent,
  locale: AppLocale,
  stateHint: string,
  message: string,
): string {
  const config = INTENT_CONFIGS[intent];
  const opening = config.opening(locale);
  const constraints = getCommonConstraints(locale);
  const closing = config.closing(locale, stateHint, message);
  return [...opening, ...constraints, ...closing].join('\n');
}
