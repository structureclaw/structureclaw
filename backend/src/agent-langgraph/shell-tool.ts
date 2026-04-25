import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentConfigurable } from './configurable.js';
import { getAllowedShellCommands, getShellTimeoutMs } from './config.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;

function isCommandAllowed(command: string): boolean {
  return getAllowedShellCommands().includes(command);
}

function truncateByBytes(value: string, maxBytes: number): { output: string; truncated: boolean } {
  const buf = Buffer.from(value, 'utf-8');
  if (buf.length <= maxBytes) return { output: value, truncated: false };
  return { output: buf.subarray(0, maxBytes).toString('utf-8'), truncated: true };
}

export function createShellTool() {
  return tool(
    async (input: { command: string; args?: string[]; timeoutMs?: number }, config: LangGraphRunnableConfig) => {
      const configurable = config.configurable as Partial<AgentConfigurable> | undefined;
      if (!configurable?.allowShell) {
        return JSON.stringify({ success: false, error: 'SHELL_DISABLED' });
      }
      if (!isCommandAllowed(input.command)) {
        return JSON.stringify({ success: false, error: 'COMMAND_DENIED', command: input.command });
      }
      const cwd = configurable.workspaceRoot;
      if (!cwd) throw new Error('workspaceRoot is not configured');
      const timeoutMs = Math.min(input.timeoutMs ?? getShellTimeoutMs(), getShellTimeoutMs());

      return await new Promise<string>((resolve) => {
        const child = spawn(input.command, input.args || [], {
          cwd,
          shell: false,
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
          settled = true;
          child.kill('SIGTERM');
          resolve(JSON.stringify({ success: false, error: 'COMMAND_TIMEOUT', stdout, stderr }));
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
          if (Buffer.byteLength(stdout, 'utf-8') < MAX_OUTPUT_BYTES) {
            stdout += chunk.toString('utf-8');
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (Buffer.byteLength(stderr, 'utf-8') < MAX_OUTPUT_BYTES) {
            stderr += chunk.toString('utf-8');
          }
        });
        child.on('close', (exitCode) => {
          if (settled) return;
          clearTimeout(timeout);
          const stdoutResult = truncateByBytes(stdout, MAX_OUTPUT_BYTES);
          const stderrResult = truncateByBytes(stderr, MAX_OUTPUT_BYTES);
          resolve(JSON.stringify({
            success: exitCode === 0,
            exitCode,
            stdout: stdoutResult.output,
            stderr: stderrResult.output,
            stdoutTruncated: stdoutResult.truncated,
            stderrTruncated: stderrResult.truncated,
          }));
        });
      });
    },
    {
      name: 'shell',
      description: 'Execute an allowlisted command in the workspace with shell disabled, timeout, and output limits.',
      schema: z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        timeoutMs: z.number().optional(),
      }),
    },
  );
}
