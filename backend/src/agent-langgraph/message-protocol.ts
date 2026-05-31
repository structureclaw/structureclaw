import { AIMessage, type BaseMessage } from '@langchain/core/messages';

type NormalizedToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  type: 'tool_call';
};

export interface ToolProtocolRepairResult {
  messages: BaseMessage[];
  repairedCount: number;
}

function messageType(message: BaseMessage): string {
  return typeof (message as any)._getType === 'function'
    ? String((message as any)._getType())
    : String((message as any).role || 'message');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function contentAsString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  try {
    return JSON.stringify(content ?? null) ?? String(content);
  } catch {
    return String(content);
  }
}

function parseToolArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeToolCall(raw: unknown): NormalizedToolCall | undefined {
  const record = asRecord(raw);
  if (!record || typeof record.id !== 'string' || !record.id.trim()) return undefined;
  const functionCall = asRecord(record.function);
  const name = typeof record.name === 'string'
    ? record.name
    : typeof functionCall?.name === 'string'
      ? functionCall.name
      : '';
  return {
    id: record.id,
    name,
    args: parseToolArgs(record.args ?? functionCall?.arguments),
    type: 'tool_call',
  };
}

function extractToolCalls(message: BaseMessage): NormalizedToolCall[] {
  const topLevel = Array.isArray((message as any).tool_calls)
    ? (message as any).tool_calls
    : undefined;
  const additionalKwargs = asRecord((message as any).additional_kwargs);
  const fromKwargs = Array.isArray(additionalKwargs?.tool_calls)
    ? additionalKwargs.tool_calls
    : undefined;
  const rawToolCalls: unknown[] = topLevel && topLevel.length > 0
    ? topLevel
    : fromKwargs ?? topLevel ?? [];
  return rawToolCalls
    .map((toolCall: unknown) => normalizeToolCall(toolCall))
    .filter((toolCall: NormalizedToolCall | undefined): toolCall is NormalizedToolCall => toolCall !== undefined);
}

function getToolCallId(message: BaseMessage): string {
  return typeof (message as any).tool_call_id === 'string'
    ? (message as any).tool_call_id
    : '';
}

function getToolName(message: BaseMessage): string {
  return typeof (message as any).name === 'string' && (message as any).name.trim()
    ? (message as any).name
    : 'tool';
}

function hasNormalizedTopLevelToolCalls(message: BaseMessage, toolCalls: NormalizedToolCall[]): boolean {
  const topLevel = Array.isArray((message as any).tool_calls)
    ? (message as any).tool_calls
    : undefined;
  return Boolean(topLevel)
    && topLevel!.length === toolCalls.length
    && topLevel!.every((toolCall: unknown, index: number) => {
      const normalized = asRecord(toolCall);
      return normalized?.id === toolCalls[index].id
        && normalized?.name === toolCalls[index].name
        && typeof normalized?.args === 'object'
        && normalized?.args !== null;
    });
}

function ensureTopLevelToolCalls(message: BaseMessage, toolCalls: NormalizedToolCall[]): BaseMessage {
  if (hasNormalizedTopLevelToolCalls(message, toolCalls)) {
    return message;
  }
  return new AIMessage({
    content: message.content as any,
    name: typeof (message as any).name === 'string' ? (message as any).name : undefined,
    additional_kwargs: asRecord((message as any).additional_kwargs),
    response_metadata: asRecord((message as any).response_metadata),
    tool_calls: toolCalls,
    id: message.id,
    usage_metadata: (message as any).usage_metadata,
    invalid_tool_calls: (message as any).invalid_tool_calls,
  } as any);
}

function stripToolCalls(message: BaseMessage, toolCalls: NormalizedToolCall[]): BaseMessage {
  const text = message.content == null ? '' : contentAsString(message.content).trim();
  const names = toolCalls
    .map((toolCall) => toolCall.name || toolCall.id)
    .filter(Boolean)
    .join(', ');
  const additionalKwargs = { ...(asRecord((message as any).additional_kwargs) ?? {}) };
  delete additionalKwargs.tool_calls;
  return new AIMessage({
    content: text || `Previous assistant tool request was repaired before model invocation: ${names || 'unknown tool calls'}.`,
    name: typeof (message as any).name === 'string' ? (message as any).name : undefined,
    additional_kwargs: additionalKwargs,
    response_metadata: asRecord((message as any).response_metadata),
    id: message.id,
    usage_metadata: (message as any).usage_metadata,
  } as any);
}

function toolResultAsAssistantMessage(message: BaseMessage): BaseMessage {
  const toolName = getToolName(message);
  const toolCallId = getToolCallId(message);
  const idSuffix = toolCallId ? ` id=${toolCallId}` : '';
  return new AIMessage({
    content: `Previous ${toolName} tool result${idSuffix}: ${contentAsString(message.content)}`,
    id: message.id,
  } as any);
}

function hasExactToolResponses(toolCalls: NormalizedToolCall[], toolMessages: BaseMessage[]): boolean {
  if (toolCalls.length === 0 || toolMessages.length !== toolCalls.length) return false;
  const expected = new Set(toolCalls.map((toolCall) => toolCall.id));
  const seen = new Set<string>();
  for (const toolMessage of toolMessages) {
    const id = getToolCallId(toolMessage);
    if (!expected.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return seen.size === expected.size;
}

export function repairToolMessageProtocol(messages: BaseMessage[]): ToolProtocolRepairResult {
  const result: BaseMessage[] = [];
  let repairedCount = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const type = messageType(message);

    if (type === 'ai') {
      const toolCalls = extractToolCalls(message);
      if (toolCalls.length === 0) {
        result.push(message);
        continue;
      }

      const toolMessages: BaseMessage[] = [];
      let nextIndex = index + 1;
      while (nextIndex < messages.length && messageType(messages[nextIndex]) === 'tool') {
        toolMessages.push(messages[nextIndex]);
        nextIndex += 1;
      }

      if (hasExactToolResponses(toolCalls, toolMessages)) {
        const repairedMessage = ensureTopLevelToolCalls(message, toolCalls);
        if (repairedMessage !== message) repairedCount += 1;
        result.push(repairedMessage, ...toolMessages);
      } else {
        repairedCount += 1 + toolMessages.length;
        result.push(stripToolCalls(message, toolCalls));
        for (const toolMessage of toolMessages) {
          result.push(toolResultAsAssistantMessage(toolMessage));
        }
      }
      index = nextIndex - 1;
      continue;
    }

    if (type === 'tool') {
      repairedCount += 1;
      result.push(toolResultAsAssistantMessage(message));
      continue;
    }

    result.push(message);
  }

  return { messages: result, repairedCount };
}
