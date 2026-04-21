/**
 * Configuration for the LangGraph agent engine.
 */
import path from 'path';
import { config } from '../config/index.js';

/** Which agent engine to use. */
export type AgentEngine = 'langgraph' | 'legacy';

/** Resolve the agent engine from environment. */
export function getAgentEngine(): AgentEngine {
  const env = process.env.AGENT_ENGINE?.trim().toLowerCase();
  if (env === 'langgraph') return 'langgraph';
  return 'legacy'; // default
}

/** Resolve the data directory for LangGraph checkpoints. */
export function getCheckpointerDataDir(): string {
  return process.env.AGENT_CHECKPOINT_DIR?.trim()
    || path.resolve(config.reportsDir, '..', 'agent-checkpoints');
}

/** Resolve the workspace root for file operations. */
export function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT?.trim()
    || path.resolve(config.reportsDir, '..', '..', '..');
}
