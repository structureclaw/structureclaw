import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';

describe('chat routes message persistence', () => {
  let app;
  let prisma;
  let agentRunSpy;
  let agentRunStreamSpy;
  let getSnapshotSpy;

  beforeAll(async () => {
    ({ prisma } = await import('../dist/utils/database.js'));

    prisma.conversation.create = jest.fn(async ({ data }) => ({
      id: 'created-chat-conv',
      ...data,
    }));
    prisma.conversation.findFirst = jest.fn(async ({ where }) => {
      if (where?.id === 'created-chat-conv') {
        return { id: 'created-chat-conv' };
      }
      return { id: 'conv-paused' };
    });
    prisma.conversation.update = jest.fn(async ({ where, data }) => ({
      id: where.id,
      ...data,
    }));
    prisma.message.findMany = jest.fn(async () => []);
    prisma.message.createMany = jest.fn(async ({ data }) => ({ count: data.length }));

    const { LangGraphAgentService } = await import('../dist/agent-langgraph/agent-service.js');
    agentRunSpy = jest.spyOn(LangGraphAgentService.prototype, 'run').mockImplementation(async (input) => ({
      conversationId: input.conversationId ?? 'agent-created-unowned',
      traceId: input.traceId ?? 'trace-created',
      startedAt: '2026-04-26T00:00:00.000Z',
      completedAt: '2026-04-26T00:00:01.000Z',
      success: true,
      response: 'assistant reply',
      mode: 'conversation',
      toolCalls: [],
    }));
    agentRunStreamSpy = jest.spyOn(LangGraphAgentService.prototype, 'runStream').mockImplementation(async function* (input) {
      yield {
        type: 'start',
        content: {
          conversationId: input.conversationId ?? 'agent-created-unowned-stream',
          traceId: input.traceId ?? 'trace-stream-created',
        },
      };
      yield {
        type: 'result',
        content: {
          conversationId: input.conversationId ?? 'agent-created-unowned-stream',
          traceId: input.traceId ?? 'trace-stream-created',
          response: 'stream assistant reply',
          success: true,
          mode: 'conversation',
          toolCalls: [],
        },
      };
    });
    getSnapshotSpy = jest
      .spyOn(LangGraphAgentService.prototype, 'getConversationSessionSnapshot')
      .mockResolvedValue(undefined);

    const { chatRoutes } = await import('../dist/api/chat.js');

    app = Fastify();
    await app.register(chatRoutes);
  });

  beforeEach(() => {
    prisma.conversation.create.mockClear();
    prisma.conversation.findFirst.mockClear();
    prisma.conversation.update.mockClear();
    prisma.message.findMany.mockClear();
    prisma.message.createMany.mockClear();
    agentRunSpy.mockClear();
    agentRunStreamSpy.mockClear();
    getSnapshotSpy.mockClear();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  test('persists paused messages with aborted metadata instead of mutating the content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/conv-paused/messages',
      payload: {
        userMessage: '继续这个对话',
        assistantContent: '当前分析尚未完成',
        assistantAborted: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.message.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.message.createMany).toHaveBeenCalledWith({
      data: [
        {
          conversationId: 'conv-paused',
          role: 'user',
          content: '继续这个对话',
        },
        {
          conversationId: 'conv-paused',
          role: 'assistant',
          content: '当前分析尚未完成',
          metadata: {
            status: 'aborted',
          },
        },
      ],
    });
  });

  test('skips paused persistence when the same traceId has already been stored', async () => {
    prisma.message.findMany.mockResolvedValueOnce([
      { metadata: { traceId: 'trace-paused-1' } },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/conv-paused/messages',
      payload: {
        userMessage: '继续这个对话',
        assistantContent: '当前分析尚未完成',
        assistantAborted: true,
        traceId: 'trace-paused-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.message.createMany).not.toHaveBeenCalled();
  });

  test('creates a conversation before invoking the agent when /message omits conversationId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/message',
      payload: {
        message: 'Design a steel frame',
        traceId: 'trace-created',
        context: { locale: 'en' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        title: 'Design a steel frame',
        type: 'general',
      },
    });
    expect(agentRunSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'created-chat-conv',
      message: 'Design a steel frame',
    }));
    expect(prisma.message.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          conversationId: 'created-chat-conv',
          role: 'user',
          content: 'Design a steel frame',
        }),
        expect.objectContaining({
          conversationId: 'created-chat-conv',
          role: 'assistant',
          content: 'assistant reply',
        }),
      ],
    });
  });

  test('creates a conversation before invoking the agent when /stream omits conversationId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/stream',
      payload: {
        message: 'Stream a steel frame design',
        traceId: 'trace-stream-created',
        context: { locale: 'en' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        title: 'Stream a steel frame design',
        type: 'general',
      },
    });
    expect(agentRunStreamSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'created-chat-conv',
      message: 'Stream a steel frame design',
    }));
    expect(prisma.message.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          conversationId: 'created-chat-conv',
          role: 'user',
          content: 'Stream a steel frame design',
        }),
        expect.objectContaining({
          conversationId: 'created-chat-conv',
          role: 'assistant',
          content: 'stream assistant reply',
        }),
      ],
    });
  });
});
