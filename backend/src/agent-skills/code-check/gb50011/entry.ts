import type { CodeCheckDomainInput } from '../types.js';
import type { CodeCheckClient } from '../rule.js';

const GB50011_ALIASES = new Set(['GB50011', 'GB50011-2010']);

export function matchesGB50011Code(code: string): boolean {
  return GB50011_ALIASES.has(code.trim().toUpperCase());
}

export async function executeGB50011CodeCheckDomain(
  engineClient: CodeCheckClient,
  input: CodeCheckDomainInput,
  engineId?: string,
): Promise<unknown> {
  const response = await engineClient.post('/code-check', {
    model_id: input.modelId,
    code: 'GB50011',
    elements: input.elements,
    context: input.context,
    engineId,
  });
  return response.data;
}
