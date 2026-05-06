import { describe, expect, test } from '@jest/globals';
import { AIMessage, ToolMessage } from '@langchain/core/messages';

describe('agent graph empty final response guard', () => {
  test('replaces an empty final response after tool results', async () => {
    const {
      buildEmptyFinalResponseFallback,
      shouldReplaceEmptyFinalResponse,
    } = await import('../../../dist/agent-langgraph/graph.js');

    const toolMessage = new ToolMessage({
      name: 'memory',
      tool_call_id: 'call-memory',
      content: '{"success":true,"entries":[]}',
    });
    const emptyResponse = new AIMessage('');

    expect(shouldReplaceEmptyFinalResponse(emptyResponse, [toolMessage])).toBe(true);
    expect(buildEmptyFinalResponseFallback('zh', ['glob_files', 'memory'])).toContain('本轮工具已执行完成');
    expect(buildEmptyFinalResponseFallback('zh', ['glob_files', 'memory'])).toContain('glob_files, memory');
  });

  test('keeps normal content and tool-call responses unchanged', async () => {
    const { shouldReplaceEmptyFinalResponse } = await import('../../../dist/agent-langgraph/graph.js');
    const toolMessage = new ToolMessage({
      name: 'memory',
      tool_call_id: 'call-memory',
      content: '{}',
    });

    expect(shouldReplaceEmptyFinalResponse(new AIMessage('done'), [toolMessage])).toBe(false);
    expect(shouldReplaceEmptyFinalResponse(new AIMessage(''), [])).toBe(false);

    const responseWithToolCall = new AIMessage({
      content: '',
      tool_calls: [{
        name: 'memory',
        args: { action: 'list' },
        id: 'call-memory',
        type: 'tool_call',
      }],
    });
    expect(shouldReplaceEmptyFinalResponse(responseWithToolCall, [toolMessage])).toBe(false);
  });
});
