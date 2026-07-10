import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';

describe('analysis routes', () => {
  let app;

  beforeAll(async () => {
    const { analysisRoutes } = await import('../dist/api/analysis.js');
    app = Fastify();
    await app.register(analysisRoutes);
  });

  afterAll(async () => {
    await app.close();
  });

  test('lists built-in seismic ground-motion catalog metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/seismic/ground-motion-catalog',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.source).toBe('builtin_artificial');
    expect(payload.records).toHaveLength(7);
    expect(payload.records[0]).toEqual(expect.objectContaining({
      id: 'SCGM-A1',
      recordType: 'artificial',
      dt: 0.02,
      duration: 20,
      unit: 'g',
      usableForAnalysis: true,
    }));
    expect(payload.records[0].values).toBeUndefined();
    expect(payload.referenceSource).toBe('metadata_only');
    expect(payload.referenceRecords).toHaveLength(7);
    expect(payload.referenceRecords[0]).toEqual(expect.objectContaining({
      id: 'SCGM-R1',
      recordType: 'reference',
      usableForAnalysis: false,
      dataAvailability: 'metadata_only',
    }));
  });

  test('preserves structured seismic workflow in analysis task schema', async () => {
    const { createAnalysisSchema } = await import('../dist/api/analysis.js');

    const parsed = createAnalysisSchema.parse({
      name: 'China seismic task',
      type: 'seismic',
      modelId: 'model-1',
      parameters: {
        dampingRatio: 0.05,
        seismicWorkflow: {
          methodPreference: 'response_spectrum',
          designBasis: {
            siteSeismic: {
              intensity: 8,
              designGroup: '2',
              siteCategory: 'III',
            },
          },
        },
        designCode: 'GB/T 50011-2010-2024',
        autoCodeCheck: true,
      },
    });

    expect(parsed.parameters.loadCases).toEqual([]);
    expect(parsed.parameters.designCode).toBe('GB/T 50011-2010-2024');
    expect(parsed.parameters.autoCodeCheck).toBe(true);
    expect(parsed.parameters.seismicWorkflow).toEqual({
      methodPreference: 'response_spectrum',
      designBasis: {
        siteSeismic: {
          intensity: 8,
          designGroup: '2',
          siteCategory: 'III',
        },
      },
    });
  });
});
