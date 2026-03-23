import { PythonWorkerRunner, resolveWorkerPath } from '../utils/python-worker-runner.js';
import type { CodeCheckClient } from '../agent-skills/code-check/rule.js';

export interface CodeCheckExecutionInput {
  action: 'code_check';
  input?: Record<string, unknown>;
}

export class CodeCheckExecutionService {
  private readonly runner = new PythonWorkerRunner<CodeCheckExecutionInput>(
    resolveWorkerPath('agent-skills/code-check/worker.py'),
  );

  async codeCheck(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runner.invoke({ action: 'code_check', input: payload });
  }
}

export function createLocalCodeCheckClient(
  service = new CodeCheckExecutionService(),
): CodeCheckClient {
  return {
    async post<T = unknown>(path: string, payload: Record<string, unknown> = {}): Promise<{ data: T }> {
      if (path !== '/code-check') {
        const error = new Error(`Unsupported local POST path: ${path}`) as Error & { statusCode?: number };
        error.statusCode = 400;
        throw error;
      }
      return { data: await service.codeCheck(payload) as T };
    },
  };
}
