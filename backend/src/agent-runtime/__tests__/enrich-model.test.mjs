import { describe, expect, test } from '@jest/globals';
import { AgentSkillRuntime } from '../../../dist/agent-runtime/index.js';

function buildNormalizedModelArtifact(payload) {
  return {
    artifactId: 'normalizedModel:test-artifact',
    kind: 'normalizedModel',
    scope: 'project',
    status: 'ready',
    revision: 1,
    producerSkillId: 'generic',
    dependencyFingerprint: 'fp-normalized-model',
    basedOn: [],
    schemaVersion: '1.0.0',
    provenance: { toolId: 'scheduled:draft_model' },
    createdAt: 0,
    updatedAt: 0,
    payload,
  };
}

describe('enrich_model scheduled step', () => {
  test('section enrich keeps existing element references valid for multi-element beam models', async () => {
    const runtime = new AgentSkillRuntime();
    const baseModel = {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: 'N1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
        { id: 'N2', x: 5, y: 0, z: 0 },
        { id: 'N3', x: 10, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
      ],
      elements: [
        { id: 'E1', type: 'beam', nodes: ['N1', 'N2'], material: 'MAT1', section: 'SEC1' },
        { id: 'E2', type: 'beam', nodes: ['N2', 'N3'], material: 'MAT1', section: 'SEC1' },
      ],
      materials: [
        { id: 'MAT1', name: 'Steel_Q235', E: 206000, nu: 0.3, rho: 7850, fy: 235 },
      ],
      sections: [
        {
          id: 'SEC1',
          name: 'Rect_200x400',
          type: 'rectangular',
          properties: { width: 0.2, height: 0.4, A: 0.08, Iy: 0.000267, Iz: 0.00107 },
        },
      ],
      load_cases: [
        {
          id: 'LC1',
          type: 'other',
          loads: [{ type: 'nodal_force', node: 'N2', fx: 0, fy: 0, fz: -1000, mx: 0, my: 0, mz: 0 }],
        },
      ],
      load_combinations: [{ id: 'COMB1', factors: { LC1: 1 } }],
      metadata: { inferredType: 'beam', source: 'generic-llm-draft' },
    };
    const pipelineState = {
      policy: {},
      bindings: {},
      artifacts: {
        normalizedModel: buildNormalizedModelArtifact(baseModel),
      },
      updatedAt: Date.now(),
    };
    const step = {
      stepId: 'normalizedModel-enrich_model-section-common',
      role: 'enricher',
      tool: 'enrich_model',
      skillId: 'section-common',
      consumes: [{ kind: 'normalizedModel', artifactId: 'normalizedModel:test-artifact', revision: 1 }],
      provides: 'normalizedModel',
      mode: 'execute',
      reason: 'Enrich normalizedModel via section-common',
    };

    const result = await runtime.executeScheduledStep({
      step,
      pipelineState,
      traceId: 'trace-enrich-model-test',
      locale: 'zh',
      postToEngineWithRetry: async () => {
        throw new Error('not used');
      },
      codeCheckClient: null,
    });

    const enrichedModel = result.artifact?.payload;
    expect(enrichedModel).toBeDefined();
    expect(enrichedModel.nodes).toHaveLength(3);
    expect(enrichedModel.elements).toHaveLength(2);
    expect(enrichedModel.load_cases?.[0]?.loads).toHaveLength(1);

    const materialIds = new Set(enrichedModel.materials.map((item) => item.id));
    const sectionIds = new Set(enrichedModel.sections.map((item) => item.id));
    for (const element of enrichedModel.elements) {
      expect(materialIds.has(element.material)).toBe(true);
      expect(sectionIds.has(element.section)).toBe(true);
    }
  });
});
