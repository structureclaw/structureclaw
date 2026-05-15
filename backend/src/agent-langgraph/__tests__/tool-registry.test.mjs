import { describe, expect, test } from '@jest/globals';

const EXPECTED_TOOL_IDS = [
  'detect_structure_type',
  'extract_draft_params',
  'build_model',
  'validate_model',
  'run_analysis',
  'run_code_check',
  'generate_report',
  'calculate',
  'ask_user_clarification',
  'set_session_config',
  'memory',
  'glob_files',
  'grep_files',
  'read_file',
  'write_file',
  'replace_in_file',
  'move_path',
  'delete_path',
  'analyze_file',
  'shell',
];

describe('tool registry: AGENT_TOOL_DEFINITIONS structure', () => {
  test('all expected tool IDs are registered', async () => {
    const { AGENT_TOOL_DEFINITIONS } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const registeredIds = AGENT_TOOL_DEFINITIONS.map((def) => def.id);
    expect(registeredIds).toHaveLength(EXPECTED_TOOL_IDS.length);
    for (const expectedId of EXPECTED_TOOL_IDS) {
      expect(registeredIds).toContain(expectedId);
    }
  });

  test('every tool definition has required fields', async () => {
    const { AGENT_TOOL_DEFINITIONS } = await import('../../../dist/agent-langgraph/tool-registry.js');

    for (const def of AGENT_TOOL_DEFINITIONS) {
      expect(typeof def.id).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(['engineering', 'interaction', 'session', 'workspace', 'memory', 'shell']).toContain(def.category);
      expect(['low', 'workspace-read', 'workspace-write', 'destructive', 'shell']).toContain(def.risk);
      expect(typeof def.defaultEnabled).toBe('boolean');
      expect(typeof def.create).toBe('function');
      expect(typeof def.displayName.zh).toBe('string');
      expect(typeof def.displayName.en).toBe('string');
      expect(def.displayName.zh.length).toBeGreaterThan(0);
      expect(def.displayName.en.length).toBeGreaterThan(0);
    }
  });

  test('shell tool has requiresShellGate set to true', async () => {
    const { AGENT_TOOL_DEFINITIONS } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const shellDef = AGENT_TOOL_DEFINITIONS.find((def) => def.id === 'shell');
    expect(shellDef).toBeDefined();
    expect(shellDef.requiresShellGate).toBe(true);
    expect(shellDef.risk).toBe('shell');
  });

  test('engineering tools are categorized correctly', async () => {
    const { AGENT_TOOL_DEFINITIONS } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const engineeringIds = [
      'detect_structure_type', 'extract_draft_params', 'build_model',
      'validate_model', 'run_analysis', 'run_code_check', 'generate_report',
      'calculate',
    ];
    for (const id of engineeringIds) {
      const def = AGENT_TOOL_DEFINITIONS.find((d) => d.id === id);
      expect(def).toBeDefined();
      expect(def.category).toBe('engineering');
    }
  });

  test('destructive tools are correctly classified', async () => {
    const { AGENT_TOOL_DEFINITIONS } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const deleteDef = AGENT_TOOL_DEFINITIONS.find((def) => def.id === 'delete_path');
    expect(deleteDef).toBeDefined();
    expect(deleteDef.risk).toBe('destructive');
  });

  test('tool IDs use snake_case format', async () => {
    const { AGENT_TOOL_DEFINITIONS } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const snakeCasePattern = /^[a-z][a-z0-9_]*$/;
    for (const def of AGENT_TOOL_DEFINITIONS) {
      expect(def.id).toMatch(snakeCasePattern);
    }
  });
});

describe('tool registry: listAgentToolDefinitions', () => {
  test('returns all tool definitions', async () => {
    const { AGENT_TOOL_DEFINITIONS, listAgentToolDefinitions } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const listed = listAgentToolDefinitions();
    expect(listed).toHaveLength(AGENT_TOOL_DEFINITIONS.length);
  });

  test('returns copies, not original references', async () => {
    const { AGENT_TOOL_DEFINITIONS, listAgentToolDefinitions } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const listed = listAgentToolDefinitions();
    // Shallow copy — object identity should differ
    for (let i = 0; i < listed.length; i++) {
      expect(listed[i]).not.toBe(AGENT_TOOL_DEFINITIONS[i]);
    }
  });

  test('IDs in listed definitions match expected set', async () => {
    const { listAgentToolDefinitions } = await import('../../../dist/agent-langgraph/tool-registry.js');

    const ids = listAgentToolDefinitions().map((def) => def.id).sort();
    const expected = [...EXPECTED_TOOL_IDS].sort();
    expect(ids).toEqual(expected);
  });
});

describe('tool registry: createRegisteredTools', () => {
  test('creates one tool instance per definition when given a minimal mock skillRuntime', async () => {
    const { AGENT_TOOL_DEFINITIONS, createRegisteredTools } = await import('../../../dist/agent-langgraph/tool-registry.js');

    // Minimal mock: only needs to satisfy factory function call signatures
    const mockSkillRuntime = {
      detectStructuralType: () => ({ key: 'unknown', mappedType: 'unknown' }),
      extractDraft: async () => ({ ok: false }),
      buildModel: async () => ({ ok: false }),
      validateModel: async () => ({ ok: false }),
      runAnalysis: async () => ({ ok: false }),
      runCodeCheck: async () => ({ ok: false }),
      generateReport: async () => ({ ok: false }),
    };

    const tools = createRegisteredTools({ skillRuntime: mockSkillRuntime });
    // Should create one tool per built-in definition (no user tools)
    expect(tools).toHaveLength(AGENT_TOOL_DEFINITIONS.length);
  });

  test('appends user-defined tools after built-in tools', async () => {
    const { AGENT_TOOL_DEFINITIONS, createRegisteredTools } = await import('../../../dist/agent-langgraph/tool-registry.js');
    const { tool } = await import('@langchain/core/tools');
    const { z } = await import('zod');

    const mockSkillRuntime = {
      detectStructuralType: () => ({ key: 'unknown', mappedType: 'unknown' }),
    };

    const userToolDef = {
      id: 'custom_user_tool',
      category: 'engineering',
      risk: 'low',
      defaultEnabled: true,
      displayName: { zh: '自定义工具', en: 'Custom Tool' },
      description: { zh: '测试工具', en: 'Test tool' },
      create: () => tool(async () => 'ok', {
        name: 'custom_user_tool',
        description: 'test',
        schema: z.object({}),
      }),
    };

    const tools = createRegisteredTools({ skillRuntime: mockSkillRuntime }, [userToolDef]);
    expect(tools).toHaveLength(AGENT_TOOL_DEFINITIONS.length + 1);
    expect(tools[tools.length - 1].name).toBe('custom_user_tool');
  });
});
