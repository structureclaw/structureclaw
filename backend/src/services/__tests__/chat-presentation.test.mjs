import Fastify from 'fastify';
import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  createEmptyAssistantPresentation,
  reducePresentationEvent,
} from '../../../dist/services/chat-presentation.js';
import { prisma } from '../../../dist/utils/database.js';

describe('chat presentation reducer', () => {
  beforeAll(async () => {
    const conversationTables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'`;
    if (conversationTables.length === 0) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE conversations (
          id TEXT NOT NULL PRIMARY KEY,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          modelSnapshot JSON,
          resultSnapshot JSON,
          latestResult JSON,
          userId TEXT
        )
      `);
    }

    const messageTables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='messages'`;
    if (messageTables.length === 0) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE messages (
          id TEXT NOT NULL PRIMARY KEY,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata JSON,
          tokenCount INTEGER,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          conversationId TEXT NOT NULL,
          FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
        )
      `);
    }
  });

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

  test('clarification timeline items retain raw user-facing text through reduction', () => {
    let state = createEmptyAssistantPresentation({
      traceId: 'trace-clarification',
      mode: 'execution',
      startedAt: '2026-04-19T10:00:00.000Z',
    });

    state = reducePresentationEvent(state, {
      type: 'timeline_item_upsert',
      item: {
        id: 'interaction:turn-1',
        kind: 'clarification',
        phase: 'understanding',
        status: 'done',
        title: 'Need more modeling details',
        previewText: 'Need more modeling details',
        explanationText: 'Critical modeling inputs are still missing.',
        rawUserFacingText: 'Please provide the span and support conditions.',
        missingCritical: ['span', 'support conditions'],
        question: 'Please provide the span and support conditions.',
        createdAt: '2026-04-19T10:00:00.010Z',
      },
    });

    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0].kind).toBe('clarification');
    expect(state.timeline[0].rawUserFacingText).toBe('Please provide the span and support conditions.');
    expect(state.timeline[0].explanationText).toBe('Critical modeling inputs are still missing.');
  });

  test('stream persistence stores presentation in assistant message metadata', async () => {
    const { AgentService } = await import('../../../dist/services/agent.js');
    const { chatRoutes } = await import('../../../dist/api/chat.js');
    const originalRunStream = AgentService.prototype.runStream;
    const conversationId = `conv-presentation-${Date.now()}`;
    const traceId = 'trace-presentation-001';

    await prisma.conversation.create({
      data: {
        id: conversationId,
        title: 'Presentation test',
        type: 'general',
      },
    });

    AgentService.prototype.runStream = async function* mockRunStream() {
      yield {
        type: 'start',
        content: {
          traceId,
          conversationId,
          startedAt: '2026-04-19T10:00:00.000Z',
        },
      };
      yield {
        type: 'presentation_init',
        presentation: createEmptyAssistantPresentation({
          traceId,
          mode: 'execution',
          startedAt: '2026-04-19T10:00:00.000Z',
        }),
      };
      yield {
        type: 'summary_replace',
        summaryText: 'Please provide the span and support conditions.',
      };
      yield {
        type: 'timeline_item_upsert',
        item: {
          id: 'interaction:turn-clarify',
          kind: 'clarification',
          phase: 'understanding',
          status: 'done',
          title: 'Need more modeling details',
          previewText: 'Need more modeling details',
          explanationText: 'Critical modeling inputs are still missing.',
          rawUserFacingText: 'Please provide the span and support conditions.',
          missingCritical: ['span', 'support conditions'],
          question: 'Please provide the span and support conditions.',
          createdAt: '2026-04-19T10:00:00.010Z',
        },
      };
      yield {
        type: 'result',
        content: {
          traceId,
          conversationId,
          startedAt: '2026-04-19T10:00:00.000Z',
          completedAt: '2026-04-19T10:00:00.050Z',
          durationMs: 50,
          success: true,
          orchestrationMode: 'llm-planned',
          needsModelInput: true,
          plan: [],
          toolCalls: [],
          interaction: {
            state: 'confirming',
            stage: 'model',
            turnId: 'turn-clarify',
            missingCritical: ['span', 'support conditions'],
            missingOptional: [],
          },
          clarification: {
            missingFields: ['span', 'support conditions'],
            question: 'Please provide the span and support conditions.',
          },
          response: 'Please provide the span and support conditions.',
        },
      };
      yield {
        type: 'presentation_complete',
        completedAt: '2026-04-19T10:00:00.050Z',
      };
      yield { type: 'done' };
    };

    const app = Fastify();
    try {
      await app.register(chatRoutes, { prefix: '/api/v1/chat' });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        payload: {
          message: '帮我建模',
          conversationId,
          traceId,
        },
      });

      expect(response.statusCode).toBe(200);

      const messages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
      });
      const assistantMessage = messages.find((message) => message.role === 'assistant');

      expect(assistantMessage).toBeTruthy();
      expect(assistantMessage?.metadata?.presentation).toBeDefined();
      expect(assistantMessage?.metadata?.presentation?.version).toBe(1);
      expect(assistantMessage?.metadata?.presentation?.summaryText).toBe('Please provide the span and support conditions.');
      expect(assistantMessage?.metadata?.presentation?.timeline).toHaveLength(1);
      expect(assistantMessage?.metadata?.presentation?.timeline?.[0]?.kind).toBe('clarification');
      expect(assistantMessage?.metadata?.presentation?.timeline?.[0]?.rawUserFacingText).toBe('Please provide the span and support conditions.');
    } finally {
      AgentService.prototype.runStream = originalRunStream;
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
      await app.close();
    }
  });
});
