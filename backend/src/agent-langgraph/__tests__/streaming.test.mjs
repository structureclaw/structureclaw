import { describe, expect, test } from '@jest/globals';
import { ToolMessage } from '@langchain/core/messages';

describe('LangGraph streaming adapter', () => {
  test('emits a summary when extract_draft_params cannot proceed', async () => {
    const { langGraphEventToChunks } = await import('../../../dist/agent-langgraph/streaming.js');
    const chunks = langGraphEventToChunks({
      tools: {
        messages: [
          new ToolMessage({
            name: 'extract_draft_params',
            tool_call_id: 'call-extract',
            content: JSON.stringify({
              canProceed: false,
              reason: '草稿仍缺少关键参数：floorLoads。',
            }),
          }),
        ],
      },
    }, 'updates');

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'summary_replace',
        summaryText: '草稿仍缺少关键参数：floorLoads。',
      }),
    ]));
  });

  test('emits a summary when memory rejects draft parameter storage', async () => {
    const { langGraphEventToChunks } = await import('../../../dist/agent-langgraph/streaming.js');
    const chunks = langGraphEventToChunks({
      tools: {
        messages: [
          new ToolMessage({
            name: 'memory',
            tool_call_id: 'call-memory',
            content: JSON.stringify({
              success: false,
              message: 'Current draft parameters cannot be stored in memory.',
            }),
          }),
        ],
      },
    }, 'updates');

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'summary_replace',
        summaryText: 'Current draft parameters cannot be stored in memory.',
      }),
    ]));
  });

  test('does not emit summaries for generic tool failure messages', async () => {
    const { langGraphEventToChunks } = await import('../../../dist/agent-langgraph/streaming.js');
    const chunks = langGraphEventToChunks({
      tools: {
        messages: [
          new ToolMessage({
            name: 'run_analysis',
            tool_call_id: 'call-analysis',
            content: JSON.stringify({
              success: false,
              message: 'OpenSees failed while reading C:\\\\tmp\\\\internal\\\\model.tcl',
            }),
          }),
        ],
      },
    }, 'updates');

    expect(chunks.some((chunk) => chunk.type === 'summary_replace')).toBe(false);
  });

  test('sanitizes and truncates user-actionable tool blocker summaries', async () => {
    const { langGraphEventToChunks } = await import('../../../dist/agent-langgraph/streaming.js');
    const chunks = langGraphEventToChunks({
      tools: {
        messages: [
          new ToolMessage({
            name: 'memory',
            tool_call_id: 'call-memory',
            content: JSON.stringify({
              success: false,
              message: `Draft params at C:\\\\tmp\\\\internal\\\\draft.json cannot be stored. ${'x'.repeat(300)}`,
            }),
          }),
        ],
      },
    }, 'updates');

    const summary = chunks.find((chunk) => chunk.type === 'summary_replace');
    expect(summary).toBeDefined();
    expect(summary.summaryText).toContain('[path]');
    expect(summary.summaryText).not.toContain('C:\\\\tmp');
    expect(summary.summaryText.length).toBeLessThanOrEqual(240);
  });
});
