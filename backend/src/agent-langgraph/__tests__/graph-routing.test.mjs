import { describe, expect, test } from '@jest/globals';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

describe('agent graph conditional routing (shouldContinue)', () => {
  test('routes to END when last message has no tool calls', async () => {
    const { shouldContinue } = await import('../../../dist/agent-langgraph/graph.js');

    const state = { messages: [new HumanMessage('hello'), new AIMessage('hi there')] };
    expect(shouldContinue(state)).toBe('__end__');
  });

  test('routes to tools when last message has tool calls', async () => {
    const { shouldContinue } = await import('../../../dist/agent-langgraph/graph.js');

    const aiMsg = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call-1', name: 'detect_structure_type', args: { message: 'beam' }, type: 'tool_call' }],
    });
    const state = { messages: [new HumanMessage('design a beam'), aiMsg] };
    expect(shouldContinue(state)).toBe('tools');
  });

  test('routes to END when messages array is empty', async () => {
    const { shouldContinue } = await import('../../../dist/agent-langgraph/graph.js');

    expect(shouldContinue({ messages: [] })).toBe('__end__');
  });

  test('routes to END when last message is a ToolMessage (no tool calls field)', async () => {
    const { shouldContinue } = await import('../../../dist/agent-langgraph/graph.js');

    const toolMsg = new ToolMessage({ content: '{}', tool_call_id: 'call-1', name: 'run_analysis' });
    const state = { messages: [new HumanMessage('run it'), toolMsg] };
    expect(shouldContinue(state)).toBe('__end__');
  });

  test('routes to END when tool_calls is an empty array', async () => {
    const { shouldContinue } = await import('../../../dist/agent-langgraph/graph.js');

    const aiMsg = new AIMessage({ content: 'done', tool_calls: [] });
    const state = { messages: [aiMsg] };
    expect(shouldContinue(state)).toBe('__end__');
  });

  test('routes to tools when multiple tool calls are present', async () => {
    const { shouldContinue } = await import('../../../dist/agent-langgraph/graph.js');

    const aiMsg = new AIMessage({
      content: '',
      tool_calls: [
        { id: 'call-1', name: 'detect_structure_type', args: {}, type: 'tool_call' },
        { id: 'call-2', name: 'extract_draft_params', args: {}, type: 'tool_call' },
      ],
    });
    const state = { messages: [aiMsg] };
    expect(shouldContinue(state)).toBe('tools');
  });
});

describe('agent graph empty final response guard', () => {
  test('buildEmptyFinalResponseFallback zh with tool names', async () => {
    const { buildEmptyFinalResponseFallback } = await import('../../../dist/agent-langgraph/graph.js');

    const msg = buildEmptyFinalResponseFallback('zh', ['run_analysis', 'validate_model']);
    expect(msg).toContain('run_analysis');
    expect(msg).toContain('validate_model');
    expect(msg).toContain('本轮工具已执行完成');
  });

  test('buildEmptyFinalResponseFallback en with empty tool list', async () => {
    const { buildEmptyFinalResponseFallback } = await import('../../../dist/agent-langgraph/graph.js');

    const msg = buildEmptyFinalResponseFallback('en', []);
    expect(msg).toContain('did not produce');
    expect(msg).not.toContain('undefined');
  });

  test('buildEmptyFinalResponseFallback deduplicates repeated tool names', async () => {
    const { buildEmptyFinalResponseFallback } = await import('../../../dist/agent-langgraph/graph.js');

    const msg = buildEmptyFinalResponseFallback('zh', ['memory', 'memory', 'glob_files']);
    // Should not have duplicate tool names
    const memoryCount = (msg.match(/memory/g) || []).length;
    expect(memoryCount).toBe(1);
  });
});

describe('agent graph runtime config', () => {
  test('raises LangGraph recursion limit above the default graph limit', async () => {
    const { getLangGraphRecursionLimit } = await import('../../../dist/agent-langgraph/agent-service.js');

    expect(getLangGraphRecursionLimit(200)).toBe(410);
    expect(getLangGraphRecursionLimit(10)).toBe(50);
    expect(getLangGraphRecursionLimit(undefined)).toBe(410);
  });
});
