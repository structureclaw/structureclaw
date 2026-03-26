import { PythonWorkerRunner, resolveWorkerPath } from '../../utils/python-worker-runner.js';
import type { AnalysisExecutionInput } from './types.js';

export class AnalysisRuntimeRunner {
  private readonly runner = new PythonWorkerRunner<AnalysisExecutionInput>(
    resolveWorkerPath('agent-skills/analysis/runtime/worker.py'),
  );

  async invoke<T = unknown>(input: AnalysisExecutionInput): Promise<T> {
    return this.runner.invoke<T>(input);
  }
}
