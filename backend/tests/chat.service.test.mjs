import { beforeEach, describe, expect, test } from '@jest/globals';
import { ChatService } from '../dist/services/chat.js';
import { prisma } from '../dist/utils/database.js';

describe('ChatService locale handling', () => {
  beforeEach(() => {
    prisma.conversation.create = async ({ data }) => ({
      id: 'conv-1',
      ...data,
      messages: [],
    });
    prisma.conversation.findUnique = async () => null;
    prisma.conversation.findFirst = async () => null;
    prisma.conversation.delete = async ({ where }) => ({ id: where.id });
    prisma.message.createMany = async () => ({ count: 2 });
    prisma.project.findUnique = async () => null;
  });

  test('returns English fallback text when locale=en', async () => {
    const svc = new ChatService();
    svc.llm = null;

    const result = await svc.sendMessage({
      message: 'Help me review a beam model',
      context: { locale: 'en' },
    });

    expect(result.conversationId).toBe('conv-1');
    expect(result.response).toContain('AI chat is unavailable');
  });

  test('streams Chinese fallback text when locale=zh', async () => {
    const svc = new ChatService();
    svc.llm = null;

    const chunks = [];
    for await (const chunk of svc.streamMessage({
      message: '请帮我检查结构模型',
      context: { locale: 'zh' },
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe('token');
    expect(chunks[0].content).toContain('AI 聊天功能未配置');
    expect(chunks[chunks.length - 1].type).toBe('done');
  });

  test('creates localized default conversation titles', async () => {
    const svc = new ChatService();

    const english = await svc.createConversation({ type: 'analysis', locale: 'en' });
    const chinese = await svc.createConversation({ type: 'analysis', locale: 'zh' });

    expect(english.title).toBe('New Conversation');
    expect(chinese.title).toBe('新对话');
  });

  test('deletes an existing conversation', async () => {
    prisma.conversation.findFirst = async () => ({ id: 'conv-delete' });
    const svc = new ChatService();

    const deleted = await svc.deleteConversation('conv-delete');

    expect(deleted).toEqual({ id: 'conv-delete' });
  });

  test('returns null when deleting a missing conversation', async () => {
    prisma.conversation.findFirst = async () => null;
    const svc = new ChatService();

    const deleted = await svc.deleteConversation('conv-missing');

    expect(deleted).toBeNull();
  });
});
