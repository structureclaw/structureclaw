import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AnalysisService } from '../dist/services/analysis.js';
import { ConversationService } from '../dist/services/conversation.js';
import { cache } from '../dist/utils/cache.js';
import { prisma } from '../dist/utils/database.js';

const coordinateSystem = (dimension = '2d') => ({
  semantics: 'global-z-up',
  version: 1,
  dimension,
  plane: dimension === '2d' ? 'xz' : null,
  dof_order: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
});

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

  test('accepts a fully typed model and canonical visualization projection without inferring axes', async () => {
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: {
        version: 1,
        source: 'model',
        dimension: 2,
        plane: 'xz',
        coordinateSemantics: 'global-z-up',
        coordinateContractVersion: 1,
        nodes: [
          { id: 'N1', position: { x: 0, y: 0, z: 0 } },
          { id: 'N2', position: { x: 5, y: 0, z: 0 } },
        ],
        elements: [{ id: 'E1', nodeIds: ['N1', 'N2'] }],
      },
      resultSnapshot: null,
      latestResult: {
        model: {
          schema_version: '2.0.0',
          coordinate_system: coordinateSystem('3d'),
          nodes: [
            { id: 'N1', x: 0, y: 0, z: 0 },
            { id: 'N2', x: 0, y: 0, z: 3 },
          ],
          elements: [{ id: 'E1', type: 'column', nodes: ['N1', 'N2'] }],
        },
      },
    });

    const snapshot = await new ConversationService().getConversationSnapshot('conv-canonical');

    expect(snapshot?.staleStructuralData).toBe(false);
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

  test('persists structural models under the provided conversation', async () => {
    const createdModel = {
      id: 'model-1',
      name: 'Portal Frame',
      conversationId: 'conv-analysis-1',
      coordinateSystem: coordinateSystem('2d'),
      nodes: [],
      elements: [],
      materials: [],
      sections: [],
    };
    const structuralModelCreate = jest.fn().mockResolvedValue(createdModel);
    prisma.structuralModel.create = structuralModelCreate;
    cache.setex = jest.fn().mockResolvedValue('OK');

    const svc = new AnalysisService();

    const model = await svc.createModel({
      name: 'Portal Frame',
      conversationId: 'conv-analysis-1',
      coordinate_system: coordinateSystem('2d'),
      nodes: [],
      elements: [],
      materials: [],
      sections: [],
    });

    expect(model).toMatchObject({
      id: 'model-1',
      coordinate_system: coordinateSystem('2d'),
      metadata: { frameDimension: '2d' },
    });
    expect(structuralModelCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Portal Frame',
        conversationId: 'conv-analysis-1',
        coordinateSystem: coordinateSystem('2d'),
      }),
    });
    expect(structuralModelCreate.mock.calls[0][0].data).not.toHaveProperty('projectId');
    expect(structuralModelCreate.mock.calls[0][0].data).not.toHaveProperty('createdBy');
  });

  test('preserves an explicit collinear 3d contract when a stored model is read', async () => {
    cache.get = jest.fn().mockResolvedValue(null);
    cache.setex = jest.fn().mockResolvedValue('OK');
    prisma.structuralModel.findUnique = jest.fn().mockResolvedValue({
      id: 'model-collinear-3d',
      name: 'Collinear 3D member',
      coordinateSystem: coordinateSystem('3d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 0, y: 0, z: 3 },
      ],
      elements: [{ id: 'E1', type: 'column', nodes: ['1', '2'] }],
      materials: [],
      sections: [],
    });

    const model = await new AnalysisService().getModel('model-collinear-3d');

    expect(model.coordinate_system).toEqual(coordinateSystem('3d'));
    expect(model.metadata.frameDimension).toBe('3d');
  });
});
