import { beforeEach, describe, expect, test } from '@jest/globals';
import { ConversationService } from '../dist/services/conversation.js';
import { prisma } from '../dist/utils/database.js';

describe('ConversationService locale handling', () => {
  beforeEach(() => {
    prisma.conversation.create = async ({ data }) => ({
      id: 'conv-1',
      ...data,
      messages: [],
    });
    prisma.conversation.findFirst = async () => null;
    prisma.conversation.findUnique = async () => null;
    prisma.conversation.delete = async ({ where }) => ({ id: where.id });
  });

  test('creates localized default conversation titles', async () => {
    const svc = new ConversationService();

    const english = await svc.createConversation({ type: 'analysis', locale: 'en' });
    const chinese = await svc.createConversation({ type: 'analysis', locale: 'zh' });

    expect(english.title).toBe('New Conversation');
    expect(chinese.title).toBe('新对话');
  });

  test('deletes an existing conversation', async () => {
    prisma.conversation.findFirst = async () => ({ id: 'conv-delete' });
    const svc = new ConversationService();

    const deleted = await svc.deleteConversation('conv-delete');

    expect(deleted).toEqual({ id: 'conv-delete' });
  });

  test('returns null when deleting a missing conversation', async () => {
    prisma.conversation.findFirst = async () => null;
    const svc = new ConversationService();

    const deleted = await svc.deleteConversation('conv-missing');

    expect(deleted).toBeNull();
  });
});
