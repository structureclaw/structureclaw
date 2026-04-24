/**
 * Configuration for the LangGraph agent engine.
 */
import path from 'path';
import { config } from '../config/index.js';

/** Resolve the data directory for LangGraph checkpoints. */
export function getCheckpointerDataDir(): string {
  return process.env.AGENT_CHECKPOINT_DIR?.trim()
    || path.resolve(config.reportsDir, '..', 'agent-checkpoints');
}

/** Resolve the workspace root for file operations. Defaults to the repository root. */
export function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT?.trim()
    || path.resolve(config.reportsDir, '..', '..');
}

/** Shell execution is intentionally disabled unless explicitly gated on. */
export function getAllowShellTools(): boolean {
  return process.env.AGENT_ALLOW_SHELL === 'true';
}

export function getAllowedShellCommands(): string[] {
  const raw = process.env.AGENT_ALLOWED_SHELL_COMMANDS?.trim();
  if (!raw) return ['node', 'npm', 'python', 'python3', './sclaw', './sclaw_cn'];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function getShellTimeoutMs(): number {
  const parsed = Number(process.env.AGENT_SHELL_TIMEOUT_MS || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300000) : 300000;
}
