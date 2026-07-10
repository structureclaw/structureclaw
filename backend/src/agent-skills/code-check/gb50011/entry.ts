import type { ExecutionRequestOptions } from '../../analysis/types.js';
import type { CodeCheckDomainInput } from '../types.js';
import type { CodeCheckClient } from '../rule.js';
import { GB50011_CANONICAL_CODE, withGB50011CodeCheckMetadata } from './metadata.js';

const GB50011_ALIASES = new Set([
  'GB50011',
  'GB50011-2010',
  'GBT50011',
  'GB/T50011',
  'GB/T 50011',
  'GBT50011-2010',
  'GB/T50011-2010',
  'GB/T 50011-2010',
  'GBT50011-2010-2024',
  'GB/T50011-2010-2024',
  'GB/T 50011-2010-2024',
  'GB55002+GBT50011',
  'GB 55002+GB/T 50011',
]);

export function matchesGB50011Code(code: string): boolean {
  return GB50011_ALIASES.has(code.trim().toUpperCase());
}

export async function executeGB50011CodeCheckDomain(
  engineClient: CodeCheckClient,
  input: CodeCheckDomainInput,
  engineId?: string,
  requestOptions?: ExecutionRequestOptions,
): Promise<unknown> {
  const response = await engineClient.post('/code-check', {
    model_id: input.modelId,
    code: GB50011_CANONICAL_CODE,
    elements: input.elements,
    context: withGB50011CodeCheckMetadata(input.context),
    engineId,
  }, requestOptions);
  return response.data;
}
