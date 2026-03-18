import type { AxiosInstance } from 'axios';
import type { CodeCheckDomainInput } from '../types.js';

export async function executeCustomCodeCheckDomain(
  engineClient: AxiosInstance,
  input: CodeCheckDomainInput,
  engineId?: string,
): Promise<unknown> {
  const normalizedCode = input.code.trim().length > 0 ? input.code.trim() : 'custom';
  const response = await engineClient.post('/code-check', {
    model_id: input.modelId,
    code: normalizedCode,
    elements: input.elements,
    context: input.context,
    engineId,
  });
  return response.data;
}
