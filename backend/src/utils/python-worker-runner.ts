import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { config, runtimeBaseDir } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PythonWorkerFailure {
  ok: false;
  errorCode: string;
  message: string;
  statusCode?: number;
  detail?: unknown;
}

interface PythonWorkerSuccess<T = unknown> {
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

  private isCommandAvailable(command: string): boolean {
    if (path.isAbsolute(command)) {
      return existsSync(command);
    }
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(lookup, [command], { stdio: 'ignore', windowsHide: true });
    if (result.error) {
      return true;
    }
    return result.status === 0;
  }

  private async resolvePythonCommand(): Promise<{ executable: string; args: string[] }> {
    const configured = config.analysisPythonBin?.trim();
    if (configured) {
      if (configured === 'python3' || configured === 'python') {
        if (this.isCommandAvailable(configured)) {
          return { executable: configured, args: [] };
        }
      }
      if (configured === 'py' || configured === 'py.exe') {
        if (this.isCommandAvailable(configured)) {
          return { executable: configured, args: ['-3'] };
        }
      }
      if (await this.isAccessibleExecutable(configured)) {
        return { executable: configured, args: [] };
      }
    }

    const backendVenv = process.platform === 'win32'
      ? path.resolve(__dirname, '../../.venv/Scripts/python.exe')
      : path.resolve(__dirname, '../../.venv/bin/python');
    const cwdBackendVenv = process.platform === 'win32'
      ? path.resolve(process.cwd(), 'backend/.venv/Scripts/python.exe')
      : path.resolve(process.cwd(), 'backend/.venv/bin/python');
    const dataDirVenv = process.platform === 'win32'
      ? path.join(runtimeBaseDir, '.venv', 'Scripts', 'python.exe')
      : path.join(runtimeBaseDir, '.venv', 'bin', 'python');

    const candidates: Array<{ executable: string; args: string[] }> = [
      { executable: backendVenv, args: [] },
      { executable: cwdBackendVenv, args: [] },
      { executable: dataDirVenv, args: [] },
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
      if (this.isCommandAvailable(candidate.executable)) {
        return candidate;
      }
    }

    throw new Error(
      'No Python executable found for StructureClaw analysis. Configure analysis.pythonBin or install the backend/.venv runtime.',
    );
  }

  async invoke<T = unknown>(input: TInput, requestOptions?: { signal?: AbortSignal }): Promise<T> {
    const pythonCommand = await this.resolvePythonCommand();
    const payload = JSON.stringify(input);
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      // Build child env: inherit process.env + inject settings-driven PKPM/YJK paths
      const childEnv: Record<string, string> = { ...process.env as Record<string, string>, PYTHONIOENCODING: 'utf-8' };
      if (config.pkpmCyclePath) childEnv.PKPM_CYCLE_PATH = config.pkpmCyclePath;
      if (config.pkpmWorkDir) childEnv.PKPM_WORK_DIR = config.pkpmWorkDir;
      delete childEnv.YJK_PATH;
      delete childEnv.YJKS_ROOT;
      delete childEnv.YJKS_EXE;
      delete childEnv.YJK_PYTHON_BIN;
      delete childEnv.YJK_WORK_DIR;
      delete childEnv.YJK_VERSION;
      delete childEnv.YJK_TIMEOUT_S;
      delete childEnv.YJK_INVISIBLE;
      delete childEnv.YJK_LAUNCHER_PREWARM;
      delete childEnv.YJK_LAUNCHER_PREWARM_S;
      delete childEnv.YJK_DIRECT_READY_TIMEOUT_S;
      if (config.yjkInstallRoot) {
        childEnv.YJK_PATH = config.yjkInstallRoot;
        childEnv.YJKS_ROOT = config.yjkInstallRoot;
      }
      if (config.yjkExePath) childEnv.YJKS_EXE = config.yjkExePath;
      if (config.yjkPythonBin) childEnv.YJK_PYTHON_BIN = config.yjkPythonBin;
      if (config.yjkWorkDir) childEnv.YJK_WORK_DIR = config.yjkWorkDir;
      if (config.yjkVersion) childEnv.YJK_VERSION = config.yjkVersion;
      childEnv.YJK_TIMEOUT_S = String(config.yjkTimeoutS);
      childEnv.YJK_INVISIBLE = config.yjkInvisible ? '1' : '0';
      childEnv.YJK_LAUNCHER_PREWARM = config.yjkLauncherPrewarm;
      childEnv.YJK_LAUNCHER_PREWARM_S = String(config.yjkLauncherPrewarmS);
      childEnv.YJK_DIRECT_READY_TIMEOUT_S = String(config.yjkDirectReadyTimeoutS);

      const child = spawn(pythonCommand.executable, [...pythonCommand.args, this.workerPath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
        windowsHide: true,
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
