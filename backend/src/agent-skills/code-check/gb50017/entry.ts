import type { CodeCheckDomainInput } from '../types.js';
import type { CodeCheckClient } from '../rule.js';

const GB50017_ALIASES = new Set(['GB50017', 'GB50017-2017']);

export function matchesGB50017Code(code: string): boolean {
  return GB50017_ALIASES.has(code.trim().toUpperCase());
}

export async function executeGB50017CodeCheckDomain(
  engineClient: CodeCheckClient,
  input: CodeCheckDomainInput,
  engineId?: string,
): Promise<unknown> {
  const response = await engineClient.post('/code-check', {
    model_id: input.modelId,
    code: 'GB50017',
    elements: input.elements,
    context: input.context,
    engineId,
  });
  return response.data;
}
