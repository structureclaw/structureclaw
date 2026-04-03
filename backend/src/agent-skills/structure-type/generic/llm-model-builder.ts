import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from '../../../services/locale.js';
import type { DraftState } from '../../../agent-runtime/types.js';
import { logger } from '../../../utils/logger.js';
import { buildGenericModelPrompt, buildRetrySuffix } from './llm-model-prompt.js';

export async function tryBuildGenericModelWithLlm(
  llm: ChatOpenAI | null,
  message: string,
  state: DraftState,
  locale: AppLocale,
  conversationHistory?: string,
): Promise<Record<string, unknown> | undefined> {
  if (!llm) {
    return undefined;
  }

  const basePrompt = buildGenericModelPrompt(message, state, locale, conversationHistory);
  const retrySuffix = buildRetrySuffix(locale);
  const stateHint = JSON.stringify(state);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? basePrompt : `${basePrompt}${retrySuffix}`;
    const startedAt = Date.now();
    logger.info({
      attempt: attempt + 1,
      locale,
      promptChars: prompt.length,
      stateHintChars: stateHint.length,
      messagePreview: message.slice(0, 160),
    }, 'generic llm model attempt started');

    try {
      const aiMessage = await llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      const parsed = parseJsonObject(content);
      if (!parsed) {
        logger.warn({
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          responseChars: content.length,
          responsePreview: content.slice(0, 200),
        }, 'generic llm model returned non-json content');
        continue;
      }

      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.elements) || !Array.isArray(parsed.load_cases)) {
        logger.warn({
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          hasNodes: Array.isArray(parsed.nodes),
          hasElements: Array.isArray(parsed.elements),
          hasLoadCases: Array.isArray(parsed.load_cases),
        }, 'generic llm model returned json without required structural arrays');
        continue;
      }

      if (typeof parsed.schema_version !== 'string') {
        parsed.schema_version = '1.0.0';
      }
      if (typeof parsed.unit_system !== 'string') {
        parsed.unit_system = 'SI';
      }

      logger.info({
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        nodeCount: parsed.nodes.length,
        elementCount: parsed.elements.length,
        loadCaseCount: parsed.load_cases.length,
      }, 'generic llm model attempt succeeded');

      return parsed;
    } catch (error) {
      logger.warn({
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }, 'generic llm model attempt failed with upstream error');
      continue;
    }
  }

  logger.warn({
    locale,
    promptChars: basePrompt.length,
    messagePreview: message.slice(0, 160),
  }, 'generic llm model exhausted all attempts without a valid model');

  return undefined;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return tryParseJson(fenced[1]);
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return tryParseJson(trimmed.slice(first, last + 1));
  }
  return null;
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}