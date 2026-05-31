import { describe, expect, test } from '@jest/globals';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

describe('agent message tool protocol repair', () => {
  test('converts orphan tool messages to assistant summaries', async () => {
    const { repairToolMessageProtocol } = await import('../../../dist/agent-langgraph/message-protocol.js');
    const result = repairToolMessageProtocol([
      new HumanMessage('continue'),
      new ToolMessage({
        name: 'run_analysis',
        tool_call_id: 'call-orphan',
        content: '{"ok":true}',
      }),
    ]);

    expect(result.repairedCount).toBe(1);
    expect(result.messages.map((message) => message._getType())).toEqual(['human', 'ai']);
    expect(String(result.messages[1].content)).toContain('Previous run_analysis tool result');
    expect(String(result.messages[1].content)).toContain('call-orphan');
  });

  test('restores top-level tool calls from additional kwargs before paired tool messages', async () => {
    const { repairToolMessageProtocol } = await import('../../../dist/agent-langgraph/message-protocol.js');
    const aiMessage = {
      _getType: () => 'ai',
      content: '',
      additional_kwargs: {
        tool_calls: [{
          id: 'call-build',
          type: 'function',
          function: {
            name: 'build_model',
            arguments: '{"span":6}',
          },
        }],
      },
    };

    const result = repairToolMessageProtocol([
      new HumanMessage('build it'),
      aiMessage,
      new ToolMessage({
        name: 'build_model',
        tool_call_id: 'call-build',
        content: '{"success":true}',
      }),
    ]);

    expect(result.repairedCount).toBe(1);
    expect(result.messages.map((message) => message._getType())).toEqual(['human', 'ai', 'tool']);
    expect(result.messages[1].tool_calls).toEqual([
      {
        id: 'call-build',
        name: 'build_model',
        args: { span: 6 },
        type: 'tool_call',
      },
    ]);
  });

  test('falls back to additional kwargs when top-level tool calls are empty and preserves metadata', async () => {
    const { repairToolMessageProtocol } = await import('../../../dist/agent-langgraph/message-protocol.js');
    const usageMetadata = {
      input_tokens: 12,
      output_tokens: 3,
      total_tokens: 15,
    };
    const invalidToolCalls = [{ id: 'bad-call', name: 'bad_tool', args: '{}', error: 'invalid' }];
    const aiMessage = {
      _getType: () => 'ai',
      id: 'ai-with-empty-tool-calls',
      content: '',
      tool_calls: [],
      additional_kwargs: {
        tool_calls: [{
          id: 'call-build',
          type: 'function',
          function: {
            name: 'build_model',
            arguments: '{"span":8}',
          },
        }],
      },
      response_metadata: { finish_reason: 'tool_calls' },
      usage_metadata: usageMetadata,
      invalid_tool_calls: invalidToolCalls,
    };

    const result = repairToolMessageProtocol([
      new HumanMessage('build it'),
      aiMessage,
      new ToolMessage({
        name: 'build_model',
        tool_call_id: 'call-build',
        content: '{"success":true}',
      }),
    ]);

    expect(result.repairedCount).toBe(1);
    expect(result.messages[1].id).toBe('ai-with-empty-tool-calls');
    expect(result.messages[1].usage_metadata).toEqual(usageMetadata);
    expect(result.messages[1].invalid_tool_calls).toEqual(invalidToolCalls);
    expect(result.messages[1].tool_calls).toEqual([
      {
        id: 'call-build',
        name: 'build_model',
        args: { span: 8 },
        type: 'tool_call',
      },
    ]);
  });

  test('strips incomplete tool-call protocol instead of sending unmatched tool messages', async () => {
    const { repairToolMessageProtocol } = await import('../../../dist/agent-langgraph/message-protocol.js');
    const result = repairToolMessageProtocol([
      new HumanMessage('do two things'),
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call-a', name: 'detect_structure_type', args: {}, type: 'tool_call' },
          { id: 'call-b', name: 'build_model', args: {}, type: 'tool_call' },
        ],
      }),
      new ToolMessage({
        name: 'detect_structure_type',
        tool_call_id: 'call-a',
        content: '{"type":"frame"}',
      }),
    ]);

    expect(result.repairedCount).toBe(2);
    expect(result.messages.map((message) => message._getType())).toEqual(['human', 'ai', 'ai']);
    expect(result.messages[1].tool_calls || []).toEqual([]);
    expect(String(result.messages[1].content)).toContain('repaired before model invocation');
    expect(String(result.messages[2].content)).toContain('Previous detect_structure_type tool result');
  });

  test('preserves ids and usage metadata when repairing incomplete tool-call history', async () => {
    const { repairToolMessageProtocol } = await import('../../../dist/agent-langgraph/message-protocol.js');
    const usageMetadata = {
      input_tokens: 10,
      output_tokens: 1,
      total_tokens: 11,
    };
    const result = repairToolMessageProtocol([
      new HumanMessage('do two things'),
      new AIMessage({
        id: 'ai-incomplete',
        content: '',
        usage_metadata: usageMetadata,
        tool_calls: [
          { id: 'call-a', name: 'detect_structure_type', args: {}, type: 'tool_call' },
          { id: 'call-b', name: 'build_model', args: {}, type: 'tool_call' },
        ],
      }),
      {
        _getType: () => 'tool',
        id: 'tool-a',
        name: 'detect_structure_type',
        tool_call_id: 'call-a',
        content: undefined,
      },
    ]);

    expect(result.repairedCount).toBe(2);
    expect(result.messages[1].id).toBe('ai-incomplete');
    expect(result.messages[1].usage_metadata).toEqual(usageMetadata);
    expect(result.messages[2].id).toBe('tool-a');
    expect(String(result.messages[2].content)).toContain('Previous detect_structure_type tool result');
    expect(String(result.messages[2].content)).toContain('null');
  });
});
