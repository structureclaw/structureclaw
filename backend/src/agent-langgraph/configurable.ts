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
  /** Requested allow-list of tool IDs for this run; undefined means registry defaults. */
  enabledToolIds?: string[];
  /** Requested deny-list of tool IDs for this run. */
  disabledToolIds?: string[];
  /** Whether shell-risk tools may be activated for this run. */
  allowShell: boolean;
  /** Current project context for future scoped tools. */
  projectId?: string;
  /** Current user context for future scoped tools. */
  userId?: string;
  /**
   * Skill scope resolved from the user's selected skills.
   * Set once per tool-node invocation by the graph; all tools read this
   * instead of independently extracting skillIds from state.
   */
  skillScope?: string[];
}
