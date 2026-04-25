import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentConfigurable } from './configurable.js';
import { AgentMemoryService, type AgentMemoryScope } from '../services/agent-memory.js';

const memoryService = new AgentMemoryService();

function resolveScope(config: LangGraphRunnableConfig): AgentMemoryScope {
  const configurable = config.configurable as Partial<AgentConfigurable> | undefined;
  if (configurable?.projectId) {
    return { scopeType: 'project', scopeId: configurable.projectId };
  }
  if (configurable?.userId) {
    return { scopeType: 'user', scopeId: configurable.userId };
  }
  throw new Error('Persistent memory requires a projectId or authenticated userId.');
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
        'Store, retrieve, list, or delete persistent user/project memory. ' +
        'Use for durable preferences, project context, and past decisions. ' +
        'Do not use for current-turn draft parameters; those live in session state.',
      schema: z.object({
        action: z.enum(['store', 'retrieve', 'list', 'delete']),
        key: z.string().optional(),
        value: z.unknown().optional(),
      }),
    },
  );
}
