import { PythonWorkerRunner, resolveWorkerPath } from '../../utils/python-worker-runner.js';
import type { AnalysisExecutionInput } from './types.js';

export class PythonAnalysisRunner {
  private readonly runner = new PythonWorkerRunner<AnalysisExecutionInput>(
    resolveWorkerPath('agent-skills/analysis/python/worker.py'),
  );

  async invoke<T = unknown>(input: AnalysisExecutionInput): Promise<T> {
    return this.runner.invoke<T>(input);
  }
}
