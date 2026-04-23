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
