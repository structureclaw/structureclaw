/**
 * Configuration for the LangGraph agent engine.
 */
import path from 'path';
import { config, runtimeBaseDir } from '../config/index.js';

/** Resolve the data directory for LangGraph checkpoints. */
export function getCheckpointerDataDir(): string {
  return config.agentCheckpointDir || path.join(runtimeBaseDir, 'agent-checkpoints');
}

/** Resolve the workspace root for file operations. Defaults to the runtime data directory. */
export function getWorkspaceRoot(): string {
  return config.agentWorkspaceRoot || runtimeBaseDir;
}

/** Resolve the directory for user-defined workspace skills. */
export function getWorkspaceSkillRoot(): string {
  return path.join(getWorkspaceRoot(), 'skills');
}

/** Resolve the directory for user-defined workspace tools. */
export function getWorkspaceToolRoot(): string {
  return path.join(getWorkspaceRoot(), 'tools');
}

/** Shell execution is intentionally disabled unless explicitly gated on. */
export function getAllowShellTools(): boolean {
  return config.agentAllowShell;
}

export function getAllowedShellCommands(): string[] {
  const raw = config.agentAllowedShells?.trim();
  if (!raw) return ['node', 'npm', 'python', 'python3', './sclaw', './sclaw_cn'];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function getShellTimeoutMs(): number {
  const parsed = config.agentShellTimeoutMs;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300000) : 300000;
}
