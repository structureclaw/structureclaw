import { prisma } from '../utils/database.js';
import type { JsonValue } from '../utils/json.js';
import {
  assertCanonicalCoordinateModel,
  STRUCTURAL_COORDINATE_CONTRACT_VERSION,
  STRUCTURAL_COORDINATE_SEMANTICS,
} from '../agent-runtime/coordinate-semantics.js';
import { resolveLocale, type AppLocale } from './locale.js';

/**
 * Conversation snapshots (latestResult, modelSnapshot, resultSnapshot) are
 * PROJECTION CACHES for chat recovery and UI rendering only. They are NOT the
 * source of truth for agent pipeline state. Pipeline truth lives in
 * AgentPipelineRun records.
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

function isStaleStructuralPayload(payload: unknown): boolean {
  const payloadRecord = asRecord(payload);
  if (hasSnapshotGeometry(payloadRecord)) {
    const firstNode = asRecord((payloadRecord?.nodes as unknown[])[0]);
    if (asRecord(firstNode?.position)) {
      return !hasCanonicalVisualizationSnapshotContract(payloadRecord as Record<string, unknown>);
    }
    return !hasCanonicalModelContract(payloadRecord as Record<string, unknown>);
  }

  const nestedModel = asRecord(payloadRecord?.model);
  if (hasSnapshotGeometry(nestedModel)) {
    return !hasCanonicalModelContract(nestedModel as Record<string, unknown>);
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

function hasSnapshotGeometry(snapshot: Record<string, unknown> | null): boolean {
  return Boolean(
    snapshot
    && Array.isArray(snapshot.nodes)
    && snapshot.nodes.length > 0
    && Array.isArray(snapshot.elements)
    && snapshot.elements.length > 0
  );
}

function hasCanonicalModelContract(model: Record<string, unknown>): boolean {
  const coordinateSystem = asRecord(model.coordinate_system);
  const dimension = coordinateSystem?.dimension;
  if (dimension !== '2d' && dimension !== '3d') return false;
  try {
    assertCanonicalCoordinateModel(model, dimension);
    return true;
  } catch {
    return false;
  }
}

function hasCanonicalVisualizationSnapshotContract(snapshot: Record<string, unknown>): boolean {
  const dimension = snapshot.dimension;
  if (
    snapshot.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS
    || snapshot.coordinateContractVersion !== STRUCTURAL_COORDINATE_CONTRACT_VERSION
    || (dimension !== 2 && dimension !== 3)
    || (dimension === 2 && snapshot.plane !== 'xz')
  ) {
    return false;
  }
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  return nodes.every((value) => {
    const position = asRecord(asRecord(value)?.position);
    if (!position) return false;
    const coordinates = [position.x, position.y, position.z];
    return coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      && (dimension === 3 || Math.abs(position.y as number) <= 1e-9);
  });
}

function getDefaultConversationTitle(locale: AppLocale): string {
  return locale === 'zh' ? '新对话' : 'New Conversation';
}

export class ConversationService {
  async createConversation(params: { title?: string; type: string; locale?: AppLocale }) {
    const locale = resolveLocale(params.locale);
    return prisma.conversation.create({
      data: {
        title: params.title || getDefaultConversationTitle(locale),
        type: params.type,
      },
    });
  }

  async getConversation(id: string) {
    return prisma.conversation.findFirst({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getConversations() {
    return prisma.conversation.findMany({
      where: {},
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

  async deleteConversation(id: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id },
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
