import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadBoundaryExecutionInput, LoadBoundaryExecutionOutput } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LoadBoundaryRuntimeRunner {
  private readonly pythonPath: string;
  private readonly skillBasePath: string;

  constructor(options?: { pythonPath?: string; skillBasePath?: string }) {
    this.pythonPath = options?.pythonPath ?? 'python';
    this.skillBasePath = options?.skillBasePath ?? __dirname;
  }

  async invoke(input: LoadBoundaryExecutionInput): Promise<LoadBoundaryExecutionOutput> {
    const { skillId, params } = input;

    // Prepare Python script execution
    // Use sys.stdin to safely read JSON parameters, avoiding shell injection risks
    // Use package bridges (dead_load, live_load, etc.) to handle hyphenated directories
    const script = `
import sys
import json

# Add skill base path to Python path
sys.path.insert(0, '${this.skillBasePath.replace(/\\/g, '\\\\')}')

try:
    # Read JSON parameters from stdin (safe from injection)
    params = json.loads(sys.stdin.read())
    # Import using package bridges (e.g., dead_load for dead-load directory)
    from ${skillId.replace(/-/g, '_')}.runtime import execute

    result = execute(params)

    print(json.dumps({
        'status': 'success',
        'data': result
    }, ensure_ascii=False))
except Exception as e:
    import traceback
    print(json.dumps({
        'status': 'error',
        'error': str(e),
        'traceback': traceback.format_exc()
    }, ensure_ascii=False))
`;

    try {
      // Use spawn with stdin for safe parameter passing
      const pythonProcess = spawn(this.pythonPath, ['-c', script], {
        cwd: this.skillBasePath,
        timeout: 30000,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      // Collect stdout
      pythonProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr
      pythonProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Write JSON parameters to stdin (safe from shell injection)
      pythonProcess.stdin?.write(JSON.stringify(params));
      pythonProcess.stdin?.end();

      // Handle process completion
      const result = await new Promise<LoadBoundaryExecutionOutput>((resolve, reject) => {
        pythonProcess.on('close', (_code) => {
          if (stderr && stderr.length > 0) {
            console.warn(`LoadBoundary runtime warning: ${stderr}`);
          }

          try {
            const output = JSON.parse(stdout.trim());
            if (output.status === 'error') {
              reject(new Error(output.error || 'Unknown error'));
            } else {
              resolve({
                status: 'success',
                data: output.data,
              });
            }
          } catch {
            reject(new Error(`Failed to parse output: ${stdout.trim()}`));
          }
        });

        pythonProcess.on('error', (error) => {
          reject(new Error(`Python process error: ${error.message}`));
        });
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`LoadBoundary runtime execution failed: ${errorMessage}`, { cause: error });
    }
  }
}
