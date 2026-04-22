/**
 * Dependency injection container for the LangGraph agent.
 *
 * Passed via config.configurable so tools and nodes can access
 * shared services without globalThis globals.
 */
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { LocalAnalysisEngineClient } from '../agent-skills/analysis/types.js';
import type { CodeCheckClient } from '../agent-skills/code-check/rule.js';
import type { LocalStructureProtocolClient } from '../services/structure-protocol-execution.js';

export interface AgentConfigurable {
  /** Skill runtime for structural engineering operations. */
  skillRuntime: AgentSkillRuntime;
  /** Analysis engine client (OpenSees, etc.). */
  engineClient: LocalAnalysisEngineClient;
  /** Code check client. */
  codeCheckClient: CodeCheckClient;
  /** Structure protocol client (validation). */
  structureProtocolClient: LocalStructureProtocolClient;
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
}
