import { describe, expect, jest, test, beforeEach } from '@jest/globals';

const mockConversationFindFirst = jest.fn();
const mockConversationCreate = jest.fn();

jest.unstable_mockModule('../dist/utils/database.js', () => ({
  prisma: {
    conversation: {
      findFirst: mockConversationFindFirst,
      create: mockConversationCreate,
    },
  },
}));

const { ensureConversationId } = await import('../dist/utils/demo-conversation.js');

describe('ensureConversationId', () => {
  beforeEach(() => {
    mockConversationFindFirst.mockReset();
    mockConversationCreate.mockReset();
  });

  test('returns provided conversation id', async () => {
    await expect(ensureConversationId('conv-existing')).resolves.toBe('conv-existing');
    expect(mockConversationFindFirst).not.toHaveBeenCalled();
    expect(mockConversationCreate).not.toHaveBeenCalled();
  });

  test('returns existing demo conversation when no id is provided', async () => {
    mockConversationFindFirst.mockResolvedValue({ id: 'conv-demo' });
    await expect(ensureConversationId(undefined, 'Model')).resolves.toBe('conv-demo');
    expect(mockConversationFindFirst).toHaveBeenCalledWith({
      where: { type: 'analysis' },
      orderBy: { createdAt: 'asc' },
    });
  });

  test('creates demo conversation when none exists', async () => {
    mockConversationFindFirst.mockResolvedValue(null);
    mockConversationCreate.mockResolvedValue({ id: 'conv-created' });
    await expect(ensureConversationId(undefined, 'Portal Frame')).resolves.toBe('conv-created');
    expect(mockConversationCreate).toHaveBeenCalledWith({
      data: {
        title: 'Portal Frame',
        type: 'analysis',
      },
    });
  });
});
