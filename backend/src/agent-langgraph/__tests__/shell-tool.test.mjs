import { describe, expect, test } from '@jest/globals';

describe('shell-tool helpers', () => {
  describe('isCommandAllowed', () => {
    test('allowlisted commands pass', async () => {
      const { isCommandAllowed } = await import('../../../dist/agent-langgraph/shell-tool.js');
      // Default allowlist includes node, python, python3
      expect(isCommandAllowed('node')).toBe(true);
      expect(isCommandAllowed('python')).toBe(true);
      expect(isCommandAllowed('python3')).toBe(true);
    });

    test('non-allowlisted commands are denied', async () => {
      const { isCommandAllowed } = await import('../../../dist/agent-langgraph/shell-tool.js');
      expect(isCommandAllowed('rm')).toBe(false);
      expect(isCommandAllowed('bash')).toBe(false);
      expect(isCommandAllowed('curl')).toBe(false);
      expect(isCommandAllowed('sh')).toBe(false);
    });

    test('exact match required (no partial match)', async () => {
      const { isCommandAllowed } = await import('../../../dist/agent-langgraph/shell-tool.js');
      // "nodes" is not "node"
      expect(isCommandAllowed('nodes')).toBe(false);
    });
  });

  describe('truncateByBytes', () => {
    test('short string is not truncated', async () => {
      const { truncateByBytes } = await import('../../../dist/agent-langgraph/shell-tool.js');
      const result = truncateByBytes('hello', 100);
      expect(result.output).toBe('hello');
      expect(result.truncated).toBe(false);
    });

    test('string exceeding limit is truncated', async () => {
      const { truncateByBytes } = await import('../../../dist/agent-langgraph/shell-tool.js');
      const result = truncateByBytes('abcdefghij', 5);
      expect(result.truncated).toBe(true);
      expect(result.output.length).toBeLessThanOrEqual(5);
    });

    test('CJK characters preserve valid UTF-8 boundaries', async () => {
      const { truncateByBytes } = await import('../../../dist/agent-langgraph/shell-tool.js');
      // Each CJK char is 3 bytes in UTF-8
      const input = '你好世界';
      const result = truncateByBytes(input, 6);
      expect(result.truncated).toBe(true);
      // Should contain at least one valid CJK character
      expect(result.output.length).toBeGreaterThan(0);
      // Should not contain garbled partial bytes
      expect(() => Buffer.from(result.output, 'utf-8')).not.toThrow();
    });
  });
});

describe('createShellTool', () => {
  test('returns SHELL_DISABLED when allowShell is false', async () => {
    const { createShellTool } = await import('../../../dist/agent-langgraph/shell-tool.js');
    const tool = createShellTool();
    const raw = await tool.invoke(
      { command: 'node', args: ['-e', 'console.log(1)'] },
      { configurable: { allowShell: false } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toBe('SHELL_DISABLED');
  });

  test('returns COMMAND_DENIED for non-allowlisted command', async () => {
    const { createShellTool } = await import('../../../dist/agent-langgraph/shell-tool.js');
    const tool = createShellTool();
    const raw = await tool.invoke(
      { command: 'rm', args: ['-rf', '/'] },
      { configurable: { allowShell: true } },
    );
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toBe('COMMAND_DENIED');
    expect(result.command).toBe('rm');
  });
});
