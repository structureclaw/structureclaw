import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PythonWorkerFailure {
  ok: false;
  errorCode: string;
  message: string;
  statusCode?: number;
  detail?: unknown;
}

export interface PythonWorkerSuccess<T = unknown> {
  ok: true;
  data: T;
}

export type PythonWorkerResponse<T = unknown> = PythonWorkerSuccess<T> | PythonWorkerFailure;

export function resolveWorkerPath(relativePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), `backend/src/${relativePath}`),
    path.resolve(process.cwd(), `src/${relativePath}`),
    path.resolve(__dirname, `../${relativePath}`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export class PythonWorkerRunner<TInput extends object> {
  constructor(private readonly workerPath: string) {}

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
      ...(process.platform === 'win32'
        ? [
            { executable: 'py', args: ['-3'] },
            { executable: 'python3', args: [] },
            { executable: 'python', args: [] },
          ]
        : [
            { executable: 'python3', args: [] },
            { executable: 'python', args: [] },
            { executable: 'py', args: ['-3'] },
          ]),
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

  async invoke<T = unknown>(input: TInput, requestOptions?: { signal?: AbortSignal }): Promise<T> {
    const pythonCommand = await this.resolvePythonCommand();
    const payload = JSON.stringify(input);
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(pythonCommand.executable, [...pythonCommand.args, this.workerPath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const onAbort = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGKILL');
        const abortError = new Error('Python worker aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      };
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        requestOptions?.signal?.removeEventListener('abort', onAbort);
        child.kill('SIGKILL');
        reject(new Error(`Python worker timed out after ${config.analysisPythonTimeoutMs}ms`));
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
        requestOptions?.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('close', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        requestOptions?.signal?.removeEventListener('abort', onAbort);
        resolve({ stdout, stderr });
      });
      if (requestOptions?.signal?.aborted) {
        onAbort();
        return;
      }
      requestOptions?.signal?.addEventListener('abort', onAbort, { once: true });
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

  private parseWorkerResponse<T>(stdout: string): PythonWorkerResponse<T> {
    const parsed = this.tryParseWorkerResponse<T>(stdout);
    if (!parsed) {
      throw new Error(`Invalid worker response: ${stdout.trim()}`);
    }
    return parsed;
  }

  private tryParseWorkerResponse<T>(stdout: string): PythonWorkerResponse<T> | null {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed) as PythonWorkerResponse<T>;
    } catch {
      return null;
    }
  }
}
