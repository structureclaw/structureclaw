export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retriable: boolean;
  };
}

const LLM_TIMEOUT_PATTERNS = [
  'request timed out',
  'timeout',
  'timed out',
  'etimedout',
  'aborterror',
];

const CONTEXT_OVERFLOW_PATTERNS = [
  'maximum context length',
  'context window',
  'too many tokens',
  'token limit exceeded',
  'reduce the length',
  'exceeds the maximum',
  '上下文',
  'token 数',
];

function errorToText(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

export function isLlmTimeoutError(error: unknown): boolean {
  const text = errorToText(error);
  return LLM_TIMEOUT_PATTERNS.some((pattern) => text.includes(pattern));
}

export function isContextOverflowError(error: unknown): boolean {
  const text = errorToText(error);
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => text.includes(pattern));
}

export function toLlmApiError(error: unknown): { statusCode: number; body: ApiErrorBody } {
  if (isLlmTimeoutError(error)) {
    return {
      statusCode: 504,
      body: {
        error: {
          code: 'LLM_TIMEOUT',
          message: 'LLM request timed out. Please retry later.',
          retriable: true,
        },
      },
    };
  }

  if (isContextOverflowError(error)) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'CONTEXT_OVERFLOW',
          message: 'Conversation exceeds model context limit.',
          retriable: false,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error.',
        retriable: false,
      },
    },
  };
}
