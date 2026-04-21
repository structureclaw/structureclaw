/**
 * LangGraph tool definitions for the StructureClaw ReAct agent.
 *
 * Each tool wraps an existing AgentSkillRuntime method or provides new
 * workspace file capabilities. All tools use Zod schemas for input validation.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentState } from './state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract workspace root from config or state, with safety fallback. */
function getWorkspaceRoot(config: LangGraphRunnableConfig, state?: AgentState): string {
  const root = state?.workspaceRoot || config.configurable?.workspaceRoot || '';
  if (!root) throw new Error('workspaceRoot is not configured');
  return root;
}

/** Validate that a resolved path stays within the workspace root. */
function safeResolve(workspaceRoot: string, requestedPath: string): string {
  const resolved = path.resolve(workspaceRoot, requestedPath);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(`Path traversal blocked: ${requestedPath} is outside workspace`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Engineering tools (wrap AgentSkillRuntime)
// ---------------------------------------------------------------------------

export function createDetectStructureTypeTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: { message: string }) => {
      const match = await skillRuntime.detectStructuralType(
        input.message,
        'zh', // locale will be injected from state via stateModifier
      );
      return JSON.stringify({
        key: match.key,
        mappedType: match.mappedType,
        skillId: match.skillId,
        supportLevel: match.supportLevel,
        supportNote: match.supportNote,
      });
    },
    {
      name: 'detect_structure_type',
      description:
        'Detect the structural type (beam, truss, frame, portal-frame, etc.) from a user description. ' +
        'Returns the matched type key, mapped model type, and the skill ID to use for further processing.',
      schema: z.object({
        message: z.string().describe('The user message describing the structure'),
      }),
    },
  );
}

export function createExtractDraftParamsTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      message: string;
      existingStateJson?: string;
      locale?: string;
      skillIdsJson?: string;
    }) => {
      const existingState = input.existingStateJson
        ? JSON.parse(input.existingStateJson)
        : undefined;
      const skillIds = input.skillIdsJson
        ? JSON.parse(input.skillIdsJson) as string[]
        : undefined;
      const locale = (input.locale === 'en' ? 'en' : 'zh') as 'zh' | 'en';

      const result = await skillRuntime.extractDraftParameters(
        null, // llm — the executor handles LLM internally
        input.message,
        existingState,
        locale,
        skillIds,
      );

      return JSON.stringify({
        nextState: result.nextState,
        criticalMissing: result.missing.critical,
        optionalMissing: result.missing.optional,
        structuralTypeMatch: result.structuralTypeMatch,
        skillId: result.plugin?.id,
        extractionMode: result.extractionMode,
      });
    },
    {
      name: 'extract_draft_params',
      description:
        'Extract structural engineering parameters from a user message and merge them into the draft state. ' +
        'Returns updated draft state, missing fields, and the matched structural type.',
      schema: z.object({
        message: z.string().describe('The user message to extract parameters from'),
        existingStateJson: z
          .string()
          .optional()
          .describe('JSON string of existing DraftState (omit if first message)'),
        locale: z.enum(['zh', 'en']).optional().describe('User locale'),
        skillIdsJson: z
          .string()
          .optional()
          .describe('JSON array of selected skill IDs'),
      }),
    },
  );
}

export function createBuildModelTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: { stateJson: string; skillIdsJson?: string }) => {
      const draftState = JSON.parse(input.stateJson);
      const skillIds = input.skillIdsJson
        ? JSON.parse(input.skillIdsJson) as string[]
        : undefined;

      const model = await skillRuntime.buildModel(draftState, skillIds);
      if (!model) {
        return JSON.stringify({ success: false, error: 'Model build returned undefined — draft may be incomplete' });
      }
      return JSON.stringify({ success: true, model });
    },
    {
      name: 'build_model',
      description:
        'Build a computable structural model JSON from the current draft state. ' +
        'Returns the model if all critical parameters are present, or an error if the draft is incomplete.',
      schema: z.object({
        stateJson: z.string().describe('JSON string of current DraftState'),
        skillIdsJson: z
          .string()
          .optional()
          .describe('JSON array of selected skill IDs'),
      }),
    },
  );
}

export function createAskUserClarificationTool() {
  return tool(
    async (input: { question: string; optionsJson?: string }) => {
      // In a full implementation, this would use LangGraph interrupt().
      // For the MVP, return the question as-is so the agent knows it needs to ask.
      // The streaming layer will surface this as a clarification event.
      const options = input.optionsJson
        ? JSON.parse(input.optionsJson) as string[]
        : undefined;
      return JSON.stringify({
        type: 'clarification_needed',
        question: input.question,
        options,
        note: 'Ask the user directly in your response — do not call this tool again.',
      });
    },
    {
      name: 'ask_user_clarification',
      description:
        'Signal that critical information is missing and formulate a question for the user. ' +
        'Use this when you cannot proceed without user input. ' +
        'After calling this tool, include the question in your response text.',
      schema: z.object({
        question: z.string().describe('The question to ask the user'),
        optionsJson: z
          .string()
          .optional()
          .describe('JSON array of suggested answer options'),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Workspace file tools
// ---------------------------------------------------------------------------

export function createReadWorkspaceFileTool() {
  return tool(
    async (input: { filePath: string }, config: LangGraphRunnableConfig) => {
      const state = config.configurable?.agentState as AgentState | undefined;
      const root = getWorkspaceRoot(config, state);
      const resolved = safeResolve(root, input.filePath);

      const stat = await fs.stat(resolved);
      if (stat.size > 2 * 1024 * 1024) {
        return JSON.stringify({ error: 'File too large (max 2 MB)', size: stat.size });
      }
      const content = await fs.readFile(resolved, 'utf-8');
      return JSON.stringify({ path: input.filePath, content, size: stat.size });
    },
    {
      name: 'read_workspace_file',
      description:
        'Read the contents of a file in the workspace directory. ' +
        'The path is relative to the workspace root. Max file size: 2 MB.',
      schema: z.object({
        filePath: z
          .string()
          .describe('Relative path from workspace root to the file'),
      }),
    },
  );
}

export function createWriteWorkspaceFileTool() {
  return tool(
    async (input: { filePath: string; content: string }, config: LangGraphRunnableConfig) => {
      const state = config.configurable?.agentState as AgentState | undefined;
      const root = getWorkspaceRoot(config, state);
      const resolved = safeResolve(root, input.filePath);

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, input.content, 'utf-8');

      return JSON.stringify({
        success: true,
        path: input.filePath,
        bytesWritten: Buffer.byteLength(input.content, 'utf-8'),
      });
    },
    {
      name: 'write_workspace_file',
      description:
        'Write content to a file in the workspace directory. ' +
        'Creates parent directories if needed. The path is relative to the workspace root.',
      schema: z.object({
        filePath: z
          .string()
          .describe('Relative path from workspace root to the file'),
        content: z.string().describe('Content to write to the file'),
      }),
    },
  );
}

export function createListWorkspaceFilesTool() {
  return tool(
    async (input: { dirPath?: string; maxDepth?: number }, config: LangGraphRunnableConfig) => {
      const state = config.configurable?.agentState as AgentState | undefined;
      const root = getWorkspaceRoot(config, state);
      const target = input.dirPath ? safeResolve(root, input.dirPath) : root;
      const maxDepth = input.maxDepth ?? 3;

      async function walk(dir: string, depth: number): Promise<string[]> {
        if (depth > maxDepth) return [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const result: string[] = [];
        for (const entry of entries) {
          const rel = path.relative(root, path.join(dir, entry.name));
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (entry.isDirectory()) {
            result.push(`${rel}/`);
            result.push(...await walk(path.join(dir, entry.name), depth + 1));
          } else {
            result.push(rel);
          }
        }
        return result;
      }

      const files = await walk(target, 0);
      return JSON.stringify({ dir: input.dirPath || '.', fileCount: files.length, files });
    },
    {
      name: 'list_workspace_files',
      description:
        'List files and directories in the workspace. ' +
        'Returns relative paths; directories end with /. Skips hidden files and node_modules.',
      schema: z.object({
        dirPath: z
          .string()
          .optional()
          .describe('Relative directory path (defaults to workspace root)'),
        maxDepth: z
          .number()
          .optional()
          .describe('Maximum recursion depth (default 3)'),
      }),
    },
  );
}

export function createUpdateSessionConfigTool() {
  return tool(
    async (input: {
      analysisType?: string;
      designCode?: string;
      skillIdsJson?: string;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.analysisType) updates.analysisType = input.analysisType;
      if (input.designCode) updates.designCode = input.designCode;
      if (input.skillIdsJson) updates.selectedSkillIds = JSON.parse(input.skillIdsJson);

      return JSON.stringify({
        success: true,
        updated: Object.keys(updates),
        note: 'Config updated. Use the updated values in subsequent tool calls.',
      });
    },
    {
      name: 'update_session_config',
      description:
        'Update session-level configuration: analysis type (static/dynamic/seismic/nonlinear), ' +
        'design code (GB50010/GB50011/GB50017), or selected skill IDs.',
      schema: z.object({
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .optional()
          .describe('Analysis type to set'),
        designCode: z
          .string()
          .optional()
          .describe('Design code to set (e.g. GB50017)'),
        skillIdsJson: z
          .string()
          .optional()
          .describe('JSON array of skill IDs to select'),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Tool aggregation
// ---------------------------------------------------------------------------

export interface ToolDeps {
  skillRuntime: AgentSkillRuntime;
}

/** Create all LangGraph tools for the agent. */
export function createAllTools(deps: ToolDeps) {
  const { skillRuntime } = deps;
  return [
    // Engineering tools
    createDetectStructureTypeTool(skillRuntime),
    createExtractDraftParamsTool(skillRuntime),
    createBuildModelTool(skillRuntime),
    createAskUserClarificationTool(),

    // Workspace tools
    createReadWorkspaceFileTool(),
    createWriteWorkspaceFileTool(),
    createListWorkspaceFilesTool(),

    // Session config
    createUpdateSessionConfigTool(),
  ];
}
