import { describe, expect, test } from '@jest/globals';
import { loadSkillManifestsFromDirectorySync, resolveBuiltinSkillManifestRoot } from '../dist/agent-runtime/skill-manifest-loader.js';
import { listAgentToolDefinitions } from '../dist/agent-langgraph/tool-registry.js';
import path from 'node:path';

const UTILITY_SKILL_IDS = ['memory', 'planning', 'read-file', 'replace', 'shell', 'write-file'];
const CURRENT_TOOL_IDS = [
  'ask_user_clarification',
  'build_model',
  'detect_structure_type',
  'extract_draft_params',
  'generate_report',
  'glob_files',
  'grep_files',
  'memory',
  'move_path',
  'read_file',
  'replace_in_file',
  'run_analysis',
  'run_code_check',
  'set_session_config',
  'shell',
  'validate_model',
  'write_file',
  'delete_path',
];

describe('code-owned agent tool registry', () => {
  const tools = listAgentToolDefinitions();

  test('current LangGraph tools are registered in code', () => {
    expect(tools.map((tool) => tool.id).sort()).toEqual([...CURRENT_TOOL_IDS].sort());
  });

  test('every tool has bilingual metadata', () => {
    for (const tool of tools) {
      expect(tool.displayName.zh.length).toBeGreaterThan(0);
      expect(tool.displayName.en.length).toBeGreaterThan(0);
      expect(tool.description.zh.length).toBeGreaterThan(0);
      expect(tool.description.en.length).toBeGreaterThan(0);
    }
  });

  test('session config uses the canonical set_session_config id', () => {
    expect(tools.some((tool) => tool.id === 'set_session_config')).toBe(true);
    expect(tools.some((tool) => tool.id === 'update_session_config')).toBe(false);
  });
});

describe('utility skill manifests do not grant tools', () => {
  const allSkills = loadSkillManifestsFromDirectorySync(path.join(resolveBuiltinSkillManifestRoot(), 'general'));
  const utilitySkills = allSkills.filter((skill) => UTILITY_SKILL_IDS.includes(skill.id));

  test('utility skill manifests still load successfully', () => {
    expect(utilitySkills.map((skill) => skill.id).sort()).toEqual([...UTILITY_SKILL_IDS].sort());
  });

  test('utility skills retain general-domain metadata', () => {
    for (const skill of utilitySkills) {
      expect(skill.domain).toBe('general');
      expect(skill.source).toBe('builtin');
      expect(skill.name.zh.length).toBeGreaterThan(0);
      expect(skill.name.en.length).toBeGreaterThan(0);
      expect(skill.description.zh.length).toBeGreaterThan(0);
      expect(skill.description.en.length).toBeGreaterThan(0);
      expect(skill.capabilities.length).toBeGreaterThan(0);
    }
  });

  test('shell skill is not auto-loaded by default', () => {
    const shell = utilitySkills.find((skill) => skill.id === 'shell');
    expect(shell).toBeDefined();
    expect(shell.autoLoadByDefault).toBe(false);
  });

  test('replace skill still depends on read-file and write-file skills', () => {
    const replace = utilitySkills.find((skill) => skill.id === 'replace');
    expect(replace).toBeDefined();
    expect(replace.requires).toContain('read-file');
    expect(replace.requires).toContain('write-file');
  });
});
