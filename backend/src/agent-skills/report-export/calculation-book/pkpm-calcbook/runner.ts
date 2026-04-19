import { PythonWorkerRunner, resolveWorkerPath } from '../../../../utils/python-worker-runner.js';

interface PkpmCalcbookInput {
  model: Record<string, unknown>;
  parameters: {
    jws_path: string;
    output_dir?: string;
  };
}

interface PkpmCalcbookResult {
  status: string;
  summary: {
    engine: string;
    jws_path: string;
    docx_path?: string;
    pdf_path?: string;
    [key: string]: unknown;
  };
  markdown?: string;
  detailed?: Record<string, unknown>;
  warnings?: string[];
}

export async function runPkpmCalcbook(jwsPath: string, outputDir?: string): Promise<PkpmCalcbookResult> {
  const workerPath = resolveWorkerPath('agent-skills/report-export/calculation-book/pkpm-calcbook/runtime.py');
  const runner = new PythonWorkerRunner<PkpmCalcbookInput>(workerPath);
  return runner.invoke<PkpmCalcbookResult>({
    model: { _pkpm_jws_path: jwsPath },
    parameters: { jws_path: jwsPath, ...(outputDir ? { output_dir: outputDir } : {}) },
  });
}
