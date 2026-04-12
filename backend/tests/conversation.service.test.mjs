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

  test('returns stale structural snapshots as incompatible when semantics version is missing', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: { dimension: 3, metadata: { inferredType: 'frame' } },
      resultSnapshot: { dimension: 3, metadata: { inferredType: 'frame' } },
      latestResult: { model: { metadata: { inferredType: 'frame' } } },
    });

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-1');

    expect(snapshot?.staleStructuralData).toBe(true);
  });


  test('marks latestResult as stale when nested model metadata is missing semantics version', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: null,
      resultSnapshot: null,
      latestResult: { model: { metadata: { inferredType: 'frame' } } },
    });

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-latest-result-stale');

    expect(snapshot?.staleStructuralData).toBe(true);
  });

  test('marks visualization snapshots with geometry but missing top-level semantics as stale', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: null,
      resultSnapshot: {
        dimension: 3,
        nodes: [
          { id: 'N1', x: 0, y: 0, z: 0 },
          { id: 'N2', x: 1, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', nodes: ['N1', 'N2'] }],
      },
      latestResult: null,
    });

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-visualization-snapshot-stale');

    expect(snapshot?.staleStructuralData).toBe(true);
  });

  test('returns non-stale when all snapshots are empty', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: null,
      resultSnapshot: null,
      latestResult: null,
    });

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-2');

    expect(snapshot?.staleStructuralData).toBe(false);
  });

  test('returns non-stale when all snapshots have unknown inferredType', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: { dimension: 3, metadata: { inferredType: 'unknown' } },
      resultSnapshot: null,
      latestResult: null,
    });

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-3');

    expect(snapshot?.staleStructuralData).toBe(false);
  });

  test('returns non-stale when conversation has no structural snapshots', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: null,
      resultSnapshot: null,
      latestResult: { success: true },
    });

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-4');

    expect(snapshot?.staleStructuralData).toBe(false);
  });
});
