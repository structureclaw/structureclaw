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
});
