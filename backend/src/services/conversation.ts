import { prisma } from '../utils/database.js';
import type { JsonValue } from '../utils/json.js';
import { STRUCTURAL_COORDINATE_SEMANTICS } from '../agent-runtime/coordinate-semantics.js';
import { resolveLocale, type AppLocale } from './locale.js';

/**
 * Conversation snapshots (latestResult, modelSnapshot, resultSnapshot) are
 * PROJECTION CACHES for chat recovery and UI rendering only. They are NOT the
 * source of truth for project pipeline state. Pipeline truth lives in
 * Project.settings.agentPipelineState and AgentPipelineRun records.
 *
 * Do NOT write pipeline state into conversation snapshots.
 * Do NOT read pipeline state from conversation snapshots for orchestration decisions.
 */

/**
 * Checks whether a structural payload (model snapshot, result snapshot, or latest result)
 * was created before the z-up migration. Returns true when:
 * - The payload has a structural inferredType (not 'unknown' or missing)
 * - The payload does NOT have coordinateSemantics === canonical z-up semantics
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
  const payloadRecord = asRecord(payload);
  if (hasSnapshotGeometry(payloadRecord)) {
    return payloadRecord?.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS;
  }

  const metadata = getStructuralMetadata(payload);
  const inferredType = typeof metadata?.inferredType === 'string' ? metadata.inferredType : undefined;
  if (!inferredType || inferredType === 'unknown') return false;
  return metadata?.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasModelGeometry(model: Record<string, unknown> | null): boolean {
  return Boolean(
    model
    && Array.isArray(model.nodes)
    && model.nodes.length > 0
    && Array.isArray(model.elements)
    && model.elements.length > 0
  );
}

function hasSnapshotGeometry(snapshot: Record<string, unknown> | null): boolean {
  return Boolean(
    snapshot
    && Array.isArray(snapshot.nodes)
    && snapshot.nodes.length > 0
    && Array.isArray(snapshot.elements)
    && snapshot.elements.length > 0
  );
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function inferFrameDimensionFromModel(model: Record<string, unknown>): '2d' | '3d' {
  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const yValues = new Set<string>();
  const zValues = new Set<string>();

  nodes.forEach((node) => {
    const record = asRecord(node);
    const y = toFiniteNumber(record?.y);
    const z = toFiniteNumber(record?.z);
    if (y !== null) {
      yValues.add(y.toFixed(6));
    }
    if (z !== null) {
      zValues.add(z.toFixed(6));
    }
  });

  return yValues.size > 1 && zValues.size > 1 ? '3d' : '2d';
}

function repairGenericLatestResult(latestResult: JsonValue | null): JsonValue | null {
  const latestResultRecord = asRecord(latestResult);
  const routing = asRecord(latestResultRecord?.routing);
  if (routing?.structuralSkillId !== 'generic') {
    return latestResult;
  }

  const model = asRecord(latestResultRecord?.model);
  if (!hasModelGeometry(model)) {
    return latestResult;
  }

  const currentMetadata = asRecord(model?.metadata);
  if (currentMetadata?.coordinateSemantics === STRUCTURAL_COORDINATE_SEMANTICS) {
    return latestResult;
  }

  const nextMetadata: Record<string, unknown> = {
    ...(currentMetadata || {}),
    coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
    frameDimension:
      currentMetadata?.frameDimension === '2d' || currentMetadata?.frameDimension === '3d'
        ? currentMetadata.frameDimension
        : inferFrameDimensionFromModel(model!),
  };

  if (typeof nextMetadata.source !== 'string' || nextMetadata.source.trim().length === 0) {
    nextMetadata.source = 'generic-llm-draft';
  }

  return {
    ...latestResultRecord,
    model: {
      ...model,
      metadata: nextMetadata,
    },
  } as JsonValue;
}

function repairVisualizationSnapshot(
  snapshot: JsonValue | null,
  model: Record<string, unknown> | null,
): JsonValue | null {
  const snapshotRecord = asRecord(snapshot);
  if (!hasSnapshotGeometry(snapshotRecord) || snapshotRecord?.coordinateSemantics === STRUCTURAL_COORDINATE_SEMANTICS) {
    return snapshot;
  }

  const metadata = asRecord(model?.metadata);
  if (metadata?.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS) {
    return snapshot;
  }

  const expectedDimension = metadata.frameDimension === '3d' ? 3 : 2;
  if (snapshotRecord?.dimension !== expectedDimension) {
    return snapshot;
  }

  return {
    ...snapshotRecord,
    coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
  } as JsonValue;
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

    const repairedLatestResult = repairGenericLatestResult(conversation.latestResult);
    const repairedModel = asRecord(asRecord(repairedLatestResult)?.model);
    const repairedModelSnapshot = repairVisualizationSnapshot(conversation.modelSnapshot, repairedModel);
    const repairedResultSnapshot = repairVisualizationSnapshot(conversation.resultSnapshot, repairedModel);

    const repaired =
      repairedLatestResult !== conversation.latestResult
      || repairedModelSnapshot !== conversation.modelSnapshot
      || repairedResultSnapshot !== conversation.resultSnapshot;

    if (repaired) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          modelSnapshot: repairedModelSnapshot,
          resultSnapshot: repairedResultSnapshot,
          latestResult: repairedLatestResult,
        } as never,
      });
    }

    const staleStructuralData =
      isStaleStructuralPayload(repairedModelSnapshot)
      || isStaleStructuralPayload(repairedResultSnapshot)
      || isStaleStructuralPayload(repairedLatestResult);

    return {
      modelSnapshot: repairedModelSnapshot,
      resultSnapshot: repairedResultSnapshot,
      latestResult: repairedLatestResult,
      staleStructuralData,
    };
  }
}
