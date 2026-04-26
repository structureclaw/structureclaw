import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import {
  createAskUserClarificationTool,
  createBuildModelTool,
  createDetectStructureTypeTool,
  createExtractDraftParamsTool,
  createGenerateReportTool,
  createRunAnalysisTool,
  createRunCodeCheckTool,
  createSetSessionConfigTool,
  createValidateModelTool,
} from './tools.js';
import { createMemoryTool } from './memory-tool.js';
import { getWorkspaceRoot } from './config.js';
import {
  createDeletePathTool,
  createGlobFilesTool,
  createGrepFilesTool,
  createMovePathTool,
  createReadFileTool,
  createReplaceInFileTool,
  createWriteFileTool,
} from './workspace-tools.js';
import { createShellTool } from './shell-tool.js';

export type AgentToolRisk = 'low' | 'workspace-read' | 'workspace-write' | 'destructive' | 'shell';
export type AgentToolCategory = 'engineering' | 'interaction' | 'session' | 'workspace' | 'memory' | 'shell';

export interface AgentToolFactoryDeps {
  skillRuntime: AgentSkillRuntime;
  workspaceRoot?: string;
}

export interface AgentToolDefinition {
  id: string;
  category: AgentToolCategory;
  risk: AgentToolRisk;
  defaultEnabled: boolean;
  requiresShellGate?: boolean;
  displayName: { zh: string; en: string };
  description: { zh: string; en: string };
  create: (deps: AgentToolFactoryDeps) => StructuredToolInterface;
}

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  {
    id: 'detect_structure_type',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '识别结构类型', en: 'Detect Structure Type' },
    description: {
      zh: '从用户描述中识别梁、桁架、框架、门式刚架等结构类型。',
      en: 'Detect beam, truss, frame, portal-frame, and related structure types from user text.',
    },
    create: ({ skillRuntime }) => createDetectStructureTypeTool(skillRuntime),
  },
  {
    id: 'extract_draft_params',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '提取草稿参数', en: 'Extract Draft Parameters' },
    description: {
      zh: '提取并合并结构草稿参数。',
      en: 'Extract and merge structural draft parameters.',
    },
    create: ({ skillRuntime }) => createExtractDraftParamsTool(skillRuntime),
  },
  {
    id: 'build_model',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '构建模型', en: 'Build Model' },
    description: {
      zh: '从当前草稿状态构建可计算结构模型。',
      en: 'Build a computable structural model from the current draft state.',
    },
    create: ({ skillRuntime }) => createBuildModelTool(skillRuntime),
  },
  {
    id: 'validate_model',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '校验模型', en: 'Validate Model' },
    description: {
      zh: '校验结构模型几何、连接、荷载与引用完整性。',
      en: 'Validate structural model geometry, connectivity, loads, and references.',
    },
    create: ({ skillRuntime }) => createValidateModelTool(skillRuntime),
  },
  {
    id: 'run_analysis',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '执行分析', en: 'Run Analysis' },
    description: {
      zh: '执行静力、动力、地震或非线性结构分析。',
      en: 'Run static, dynamic, seismic, or nonlinear structural analysis.',
    },
    create: ({ skillRuntime }) => createRunAnalysisTool(skillRuntime),
  },
  {
    id: 'run_code_check',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '规范校核', en: 'Run Code Check' },
    description: {
      zh: '基于模型和分析结果执行规范校核。',
      en: 'Run design-code checks from the model and analysis results.',
    },
    create: ({ skillRuntime }) => createRunCodeCheckTool(skillRuntime),
  },
  {
    id: 'generate_report',
    category: 'engineering',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '生成报告', en: 'Generate Report' },
    description: {
      zh: '生成结构分析和校核报告。',
      en: 'Generate structural analysis and code-check reports.',
    },
    create: ({ skillRuntime }) => createGenerateReportTool(skillRuntime),
  },
  {
    id: 'ask_user_clarification',
    category: 'interaction',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '询问澄清', en: 'Ask Clarification' },
    description: {
      zh: '暂停执行并向用户询问缺失信息。',
      en: 'Pause execution and ask the user for missing information.',
    },
    create: () => createAskUserClarificationTool(),
  },
  {
    id: 'set_session_config',
    category: 'session',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '设置会话配置', en: 'Set Session Config' },
    description: {
      zh: '设置当前会话的分析类型、设计规范和技能选择。',
      en: 'Set current-session analysis type, design code, and selected skills.',
    },
    create: () => createSetSessionConfigTool(),
  },
  {
    id: 'memory',
    category: 'memory',
    risk: 'low',
    defaultEnabled: true,
    displayName: { zh: '持久记忆', en: 'Persistent Memory' },
    description: {
      zh: '存储和检索工程记忆。支持 conversation（当前会话）和 workspace（跨会话持久）两种 scope。',
      en: 'Store and retrieve engineering memory. Supports conversation (current session) and workspace (cross-session persistent) scopes.',
    },
    create: () => createMemoryTool(getWorkspaceRoot()),
  },
  {
    id: 'glob_files',
    category: 'workspace',
    risk: 'workspace-read',
    defaultEnabled: true,
    displayName: { zh: '查找文件', en: 'Find Files' },
    description: { zh: '按 glob 模式列出工作区文件。', en: 'List workspace files by glob pattern.' },
    create: () => createGlobFilesTool(),
  },
  {
    id: 'grep_files',
    category: 'workspace',
    risk: 'workspace-read',
    defaultEnabled: true,
    displayName: { zh: '搜索内容', en: 'Search Files' },
    description: { zh: '按文本内容搜索工作区文件。', en: 'Search workspace files by text content.' },
    create: () => createGrepFilesTool(),
  },
  {
    id: 'read_file',
    category: 'workspace',
    risk: 'workspace-read',
    defaultEnabled: true,
    displayName: { zh: '读取文件', en: 'Read File' },
    description: { zh: '读取工作区内文本文件。', en: 'Read a text file inside the workspace.' },
    create: () => createReadFileTool(),
  },
  {
    id: 'write_file',
    category: 'workspace',
    risk: 'workspace-write',
    defaultEnabled: true,
    displayName: { zh: '写入文件', en: 'Write File' },
    description: { zh: '写入工作区内文本文件。', en: 'Write a text file inside the workspace.' },
    create: () => createWriteFileTool(),
  },
  {
    id: 'replace_in_file',
    category: 'workspace',
    risk: 'workspace-write',
    defaultEnabled: true,
    displayName: { zh: '替换文本', en: 'Replace In File' },
    description: { zh: '对单个文件执行精确文本替换。', en: 'Perform exact text replacement in one file.' },
    create: () => createReplaceInFileTool(),
  },
  {
    id: 'move_path',
    category: 'workspace',
    risk: 'workspace-write',
    defaultEnabled: true,
    displayName: { zh: '移动文件', en: 'Move File' },
    description: { zh: '移动或重命名工作区文件。', en: 'Move or rename a workspace file.' },
    create: () => createMovePathTool(),
  },
  {
    id: 'delete_path',
    category: 'workspace',
    risk: 'destructive',
    defaultEnabled: true,
    displayName: { zh: '删除文件', en: 'Delete File' },
    description: { zh: '删除工作区内单个文件。', en: 'Delete one file inside the workspace.' },
    create: () => createDeletePathTool(),
  },
  {
    id: 'shell',
    category: 'shell',
    risk: 'shell',
    defaultEnabled: true,
    requiresShellGate: true,
    displayName: { zh: '受限命令执行', en: 'Restricted Shell Execution' },
    description: { zh: '在工作区中执行白名单命令。', en: 'Run allowlisted commands inside the workspace.' },
    create: () => createShellTool(),
  },
];

export function listAgentToolDefinitions(): AgentToolDefinition[] {
  return AGENT_TOOL_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function createRegisteredTools(deps: AgentToolFactoryDeps, userTools?: AgentToolDefinition[]): StructuredToolInterface[] {
  const builtinTools = AGENT_TOOL_DEFINITIONS.map((definition) => definition.create(deps));
  const customTools = (userTools ?? []).map((definition) => definition.create(deps));
  return [...builtinTools, ...customTools];
}
