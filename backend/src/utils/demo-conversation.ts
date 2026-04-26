import { prisma } from './database.js';

export async function ensureConversationId(conversationId?: string, title = 'Analysis Model'): Promise<string> {
  if (conversationId) {
    return conversationId;
  }

  const existingConversation = await prisma.conversation.findFirst({
    where: { type: 'analysis' },
    orderBy: { createdAt: 'asc' },
  });

  if (existingConversation) {
    return existingConversation.id;
  }

  const conversation = await prisma.conversation.create({
    data: {
      title,
      type: 'analysis',
    },
  });

  return conversation.id;
}
