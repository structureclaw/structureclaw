import { prisma } from '../utils/database.js';
import type { JsonValue } from '../utils/json.js';
import { resolveLocale, type AppLocale } from './locale.js';

/**
 * Checks whether a structural payload (model snapshot, result snapshot, or latest result)
 * was created before the z-up migration. Returns true when:
 * - The payload has a structural inferredType (not 'unknown' or missing)
 * - The payload does NOT have coordinateSemanticsVersion === 2
 */
function getStructuralMetadata(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (record.metadata && typeof record.metadata === 'object') {
    return record.metadata as Record<string, unknown>;
  }
  const model = record.model;
  if (model && typeof model === 'object') {
    const modelRecord = model as Record<string, unknown>;
    if (modelRecord.metadata && typeof modelRecord.metadata === 'object') {
      return modelRecord.metadata as Record<string, unknown>;
    }
  }
  return null;
}

export function isStaleStructuralPayload(payload: unknown): boolean {
  const metadata = getStructuralMetadata(payload);
  const inferredType = typeof metadata?.inferredType === 'string' ? metadata.inferredType : undefined;
  if (!inferredType || inferredType === 'unknown') return false;
  return metadata?.coordinateSemanticsVersion !== 2;
}

function getDefaultConversationTitle(locale: AppLocale): string {
  return locale === 'zh' ? '新对话' : 'New Conversation';
}

export class ConversationService {
  async createConversation(params: { title?: string; type: string; userId?: string; locale?: AppLocale }) {
    const locale = resolveLocale(params.locale);
    return prisma.conversation.create({
      data: {
        title: params.title || getDefaultConversationTitle(locale),
        type: params.type,
        userId: params.userId,
      },
    });
  }

  async getConversation(id: string, userId?: string) {
    return prisma.conversation.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getUserConversations(userId?: string) {
    return prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        type: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async deleteConversation(id: string, userId?: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!conversation) {
      return null;
    }

    await prisma.conversation.delete({
      where: { id: conversation.id },
    });

    return conversation;
  }

  async saveConversationSnapshot(params: {
    conversationId: string;
    modelSnapshot?: Record<string, unknown> | null;
    resultSnapshot?: Record<string, unknown> | null;
    latestResult?: Record<string, unknown> | null;
  }): Promise<void> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (params.modelSnapshot !== undefined) {
      updateData.modelSnapshot = params.modelSnapshot;
    }
    if (params.resultSnapshot !== undefined) {
      updateData.resultSnapshot = params.resultSnapshot;
    }
    if (params.latestResult !== undefined) {
      updateData.latestResult = params.latestResult;
    }

    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: updateData as never,
    });
  }

  async getConversationSnapshot(conversationId: string): Promise<{
    modelSnapshot?: JsonValue | null;
    resultSnapshot?: JsonValue | null;
    latestResult?: JsonValue | null;
    staleStructuralData?: boolean;
  } | null> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        modelSnapshot: true,
        resultSnapshot: true,
        latestResult: true,
      },
    });

    if (!conversation) return null;

    const staleStructuralData =
      isStaleStructuralPayload(conversation.modelSnapshot)
      || isStaleStructuralPayload(conversation.resultSnapshot)
      || isStaleStructuralPayload(conversation.latestResult);

    return {
      modelSnapshot: conversation.modelSnapshot,
      resultSnapshot: conversation.resultSnapshot,
      latestResult: conversation.latestResult,
      staleStructuralData,
    };
  }
}
