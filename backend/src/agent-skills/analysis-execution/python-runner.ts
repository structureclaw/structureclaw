import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { config } from '../../config/index.js';
import type { AnalysisExecutionInput, AnalysisExecutionResponse } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWorkerPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'backend/src/agent-skills/analysis-execution/python/worker.py'),
    path.resolve(process.cwd(), 'src/agent-skills/analysis-execution/python/worker.py'),
    path.resolve(__dirname, '../../agent-skills/analysis-execution/python/worker.py'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export class PythonAnalysisRunner {
  private readonly workerPath = resolveWorkerPath();

  private async isAccessibleExecutable(candidate: string): Promise<boolean> {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  }

  private async resolvePythonCommand(): Promise<{ executable: string; args: string[] }> {
    const configured = config.analysisPythonBin?.trim();
    if (configured) {
      if (configured === 'python3' || configured === 'python') {
        return { executable: configured, args: [] };
      }
      if (configured === 'py' || configured === 'py.exe') {
        return { executable: configured, args: ['-3'] };
      }
      if (await this.isAccessibleExecutable(configured)) {
        return { executable: configured, args: [] };
      }
    }

    const candidates: Array<{ executable: string; args: string[] }> = [
      { executable: path.resolve(process.cwd(), 'backend/.venv/Scripts/python.exe'), args: [] },
      { executable: path.resolve(process.cwd(), '.venv/Scripts/python.exe'), args: [] },
      { executable: path.resolve(process.cwd(), 'backend/.venv/bin/python'), args: [] },
      { executable: path.resolve(process.cwd(), '.venv/bin/python'), args: [] },
      { executable: 'py', args: ['-3'] },
      { executable: 'python3', args: [] },
      { executable: 'python', args: [] },
    ];

    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate.executable)) {
        if (process.platform === 'win32' && candidate.executable === 'python') {
          continue;
        }
        return candidate;
      }
      if (await this.isAccessibleExecutable(candidate.executable)) {
        return candidate;
      }
    }

    return process.platform === 'win32'
      ? { executable: 'py', args: ['-3'] }
      : { executable: 'python3', args: [] };
  }

  async invoke<T = unknown>(input: AnalysisExecutionInput): Promise<T> {
    const pythonCommand = await this.resolvePythonCommand();
    const payload = JSON.stringify(input);
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(pythonCommand.executable, [...pythonCommand.args, this.workerPath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Python analysis worker timed out after ${config.analysisPythonTimeoutMs}ms`));
      }, config.analysisPythonTimeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ stdout, stderr });
      });
      child.stdin.end(payload);
    });

    if (!stdout.trim() && stderr.trim()) {
      throw new Error(stderr.trim());
    }

    const parsed = this.parseWorkerResponse<T>(stdout);
    if (!parsed.ok) {
      const error = new Error(parsed.message) as Error & {
        errorCode?: string;
        statusCode?: number;
        detail?: unknown;
      };
      error.errorCode = parsed.errorCode;
      error.statusCode = parsed.statusCode;
      error.detail = parsed.detail ?? (stderr.trim() || undefined);
      throw error;
    }
    return parsed.data;
  }

  private parseWorkerResponse<T>(stdout: string): AnalysisExecutionResponse<T> {
    const parsed = this.tryParseWorkerResponse<T>(stdout);
    if (!parsed) {
      throw new Error(`Invalid worker response: ${stdout.trim()}`);
    }
    return parsed;
  }

  private tryParseWorkerResponse<T>(stdout: string): AnalysisExecutionResponse<T> | null {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed) as AnalysisExecutionResponse<T>;
    } catch {
      return null;
    }
  }
}
