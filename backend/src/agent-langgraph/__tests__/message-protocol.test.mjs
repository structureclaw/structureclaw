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
});
