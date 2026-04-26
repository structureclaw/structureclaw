import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { AgentMemoryService, type AgentMemoryScope } from '../services/agent-memory.js';

const memoryService = new AgentMemoryService();

function resolveScope(config: LangGraphRunnableConfig): AgentMemoryScope {
  const configurable = config.configurable as { thread_id?: unknown } | undefined;
  const threadId = typeof configurable?.thread_id === 'string' ? configurable.thread_id.trim() : '';
  if (!threadId) {
    throw new Error('Persistent memory requires a conversation thread_id.');
  }
  return { scopeType: 'conversation', scopeId: threadId };
}

export function createMemoryTool() {
  return tool(
    async (input: { action: 'store' | 'retrieve' | 'list' | 'delete'; key?: string; value?: unknown }, config: LangGraphRunnableConfig) => {
      const scope = resolveScope(config);
      if (input.action === 'store') {
        if (!input.key) throw new Error('key is required for store');
        if (input.value === undefined) throw new Error('value is required for store');
        const entry = await memoryService.store(scope, input.key, input.value as never);
        return JSON.stringify({ success: true, entry });
      }
      if (input.action === 'retrieve') {
        if (!input.key) throw new Error('key is required for retrieve');
        const entry = await memoryService.retrieve(scope, input.key);
        return JSON.stringify({ success: true, entry });
      }
      if (input.action === 'delete') {
        if (!input.key) throw new Error('key is required for delete');
        const deleted = await memoryService.delete(scope, input.key);
        return JSON.stringify({ success: true, deleted });
      }
      const entries = await memoryService.list(scope);
      return JSON.stringify({ success: true, entries });
    },
    {
      name: 'memory',
      description:
        'Store, retrieve, list, or delete persistent memory for the current engineering conversation. ' +
        'Use for durable preferences, constraints, and confirmed engineering decisions. ' +
        'Do not use for current-turn draft parameters; those live in session state.',
      schema: z.object({
        action: z.enum(['store', 'retrieve', 'list', 'delete']),
        key: z.string().optional(),
        value: z.unknown().optional(),
      }),
    },
  );
}
