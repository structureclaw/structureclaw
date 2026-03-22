import type { CodeCheckDomainInput } from '../types.js';
import type { CodeCheckClient } from '../rule.js';

const GB50010_ALIASES = new Set(['GB50010', 'GB50010-2010']);

export function matchesGB50010Code(code: string): boolean {
  return GB50010_ALIASES.has(code.trim().toUpperCase());
}

export async function executeGB50010CodeCheckDomain(
  engineClient: CodeCheckClient,
  input: CodeCheckDomainInput,
  engineId?: string,
): Promise<unknown> {
  const response = await engineClient.post('/code-check', {
    model_id: input.modelId,
    code: 'GB50010',
    elements: input.elements,
    context: input.context,
    engineId,
  });
  return response.data;
}
