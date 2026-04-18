import { describe, expect, test } from '@jest/globals';
import {
  createEmptyAssistantPresentation,
  reducePresentationEvent,
} from '../../../dist/services/chat-presentation.js';

describe('chat presentation reducer', () => {
  test('initializes and upserts timeline + artifacts', () => {
    let state = createEmptyAssistantPresentation({
      traceId: 'trace-1',
      mode: 'execution',
      startedAt: '2026-04-19T10:00:00.000Z',
    });

    state = reducePresentationEvent(state, {
      type: 'timeline_item_upsert',
      item: {
        id: 'step-draft-model',
        kind: 'step',
        phase: 'modeling',
        tool: 'draft_model',
        status: 'running',
        title: '开始生成结构模型',
      },
    });

    state = reducePresentationEvent(state, {
      type: 'artifact_upsert',
      artifact: {
        artifact: 'model',
        status: 'available',
        title: '结构模型',
        previewable: true,
        snapshotKey: 'modelSnapshot',
      },
    });

    state = reducePresentationEvent(state, {
      type: 'summary_replace',
      summaryText: '模型已生成，可继续分析。',
    });

    expect(state.summaryText).toBe('模型已生成，可继续分析。');
    expect(state.timeline).toHaveLength(1);
    expect(state.artifacts[0].artifact).toBe('model');
  });
});
