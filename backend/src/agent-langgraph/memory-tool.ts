import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { AgentMemoryService, type AgentMemoryScope, type AgentMemoryScopeType } from '../services/agent-memory.js';

function resolveScope(
  requestedScope: AgentMemoryScopeType,
  config: LangGraphRunnableConfig,
): AgentMemoryScope {
  if (requestedScope === 'workspace') {
    return { scopeType: 'workspace', scopeId: 'default' };
  }
  const configurable = config.configurable as { thread_id?: unknown } | undefined;
  const threadId = typeof configurable?.thread_id === 'string' ? configurable.thread_id.trim() : '';
  if (!threadId) {
    throw new Error('Conversation-scoped memory requires a conversation thread_id.');
  }
  return { scopeType: 'conversation', scopeId: threadId };
}

export function createMemoryTool(workspaceRoot?: string) {
  const memoryService = new AgentMemoryService(workspaceRoot);

  return tool(
    async (
      input: { action: 'store' | 'retrieve' | 'list' | 'delete'; key?: string; value?: unknown; scope?: AgentMemoryScopeType },
      config: LangGraphRunnableConfig,
    ) => {
      const effectiveScope = input.scope ?? 'conversation';
      const scope = resolveScope(effectiveScope, config);

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
        'Store, retrieve, list, or delete persistent memory. ' +
        'Supports two scopes: "conversation" (default, current session only) and ' +
        '"workspace" (cross-session, persists across conversations). ' +
        'Use workspace scope for reusable preferences, durable constraints, and confirmed engineering decisions. ' +
        'Do not use for current-turn draft parameters; those live in session state.',
      schema: z.object({
        action: z.enum(['store', 'retrieve', 'list', 'delete']),
        key: z.string().optional(),
        value: z.unknown().optional(),
        scope: z.enum(['conversation', 'workspace']).optional().describe(
          'Memory scope: "conversation" (current session, default) or "workspace" (cross-session persistent).',
        ),
      }),
    },
  );
}
