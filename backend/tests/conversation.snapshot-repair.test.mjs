import { beforeEach, describe, expect, test } from '@jest/globals';
import { ConversationService } from '../dist/services/conversation.js';
import { prisma } from '../dist/utils/database.js';

function makeSnapshot(source) {
  return {
    version: 1,
    title: 'Generic Beam',
    source,
    dimension: 2,
    plane: 'xz',
    availableViews: source === 'result' ? ['model', 'deformed', 'forces', 'reactions'] : ['model'],
    defaultCaseId: source === 'result' ? 'result' : 'model',
    nodes: [
      { id: 'N1', position: { x: 0, y: 0, z: 0 } },
      { id: 'N2', position: { x: 10, y: 0, z: 0 } },
    ],
    elements: [
      { id: 'E1', type: 'beam', nodeIds: ['N1', 'N2'] },
    ],
    loads: [],
    unsupportedElementTypes: [],
    cases: [
      {
        id: source === 'result' ? 'result' : 'model',
        label: source === 'result' ? 'Result' : 'Model',
        kind: source === 'result' ? 'result' : 'case',
        nodeResults: {},
        elementResults: {},
      },
    ],
  };
}

describe('ConversationService snapshot repair', () => {
  beforeEach(() => {
    prisma.conversation.findUnique = async () => null;
    prisma.conversation.update = async ({ data }) => data;
  });

  test('repairs metadata-free generic snapshots so older conversations remain restorable', async () => {
    let updatePayload;
    prisma.conversation.findUnique = async () => ({
      modelSnapshot: makeSnapshot('model'),
      resultSnapshot: makeSnapshot('result'),
      latestResult: {
        routing: { structuralSkillId: 'generic' },
        model: {
          schema_version: '1.0.0',
          unit_system: 'SI',
          nodes: [
            { id: 'N1', x: 0, y: 0, z: 0 },
            { id: 'N2', x: 10, y: 0, z: 0 },
          ],
          elements: [
            { id: 'E1', type: 'beam', nodes: ['N1', 'N2'] },
          ],
          materials: [],
          sections: [],
          load_cases: [{ id: 'LC1', loads: [] }],
          load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
        },
      },
    });
    prisma.conversation.update = async ({ data }) => {
      updatePayload = data;
      return data;
    };

    const svc = new ConversationService();
    const snapshot = await svc.getConversationSnapshot('conv-generic-repair');

    expect(snapshot?.modelSnapshot?.coordinateSemantics).toBe('global-z-up');
    expect(snapshot?.resultSnapshot?.coordinateSemantics).toBe('global-z-up');
    expect(snapshot?.latestResult?.model?.metadata?.coordinateSemantics).toBe('global-z-up');
    expect(snapshot?.latestResult?.model?.metadata?.frameDimension).toBe('2d');
    expect(snapshot?.staleStructuralData).toBe(false);
    expect(updatePayload?.modelSnapshot?.coordinateSemantics).toBe('global-z-up');
    expect(updatePayload?.resultSnapshot?.coordinateSemantics).toBe('global-z-up');
  });
});
