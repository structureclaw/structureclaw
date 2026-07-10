import { describe, expect, test } from '@jest/globals';

describe('seismic workflow context', () => {
  test('extracts structured seismic workflow context without creating draft state', async () => {
    const { extractContextSeismicWorkflow } = await import('../../../dist/agent-langgraph/agent-service.js');

    const seismicWorkflow = {
      methodPreference: 'elastic_plastic_time_history',
      performanceObjective: {
        level: 'rare',
        limitDriftRatio: 0.02,
      },
    };

    expect(extractContextSeismicWorkflow({ seismicWorkflow })).toBe(seismicWorkflow);
  });

  test('ignores empty or non-object seismic workflow context', async () => {
    const { extractContextSeismicWorkflow } = await import('../../../dist/agent-langgraph/agent-service.js');

    expect(extractContextSeismicWorkflow()).toBeNull();
    expect(extractContextSeismicWorkflow({ seismicWorkflow: {} })).toBeNull();
    expect(extractContextSeismicWorkflow({ seismicWorkflow: [] })).toBeNull();
    expect(extractContextSeismicWorkflow({ seismicWorkflow: null })).toBeNull();
  });

  test('enriches uploaded ground-motion workflow with parsed attachment records', async () => {
    const { extractContextSeismicWorkflow } = await import('../../../dist/agent-langgraph/agent-service.js');

    const result = extractContextSeismicWorkflow({
      seismicWorkflow: {
        methodPreference: 'time_history',
        groundMotionSet: {
          source: 'uploaded',
          requiredCount: 1,
        },
      },
    }, [{
      attachment: {
        fileId: 'file-gm-1',
        originalName: 'uploaded-wave.csv',
        relPath: '.uploads/run/uploaded-wave.csv',
        mimeType: 'text/csv',
      },
      analysis: {
        success: true,
        type: 'csv',
        headers: ['time', 'accel'],
        rows: [['0.00', '0.00'], ['0.02', '0.01'], ['0.04', '-0.01']],
      },
    }]);

    expect(result?.groundMotionSet).toMatchObject({
      source: 'uploaded',
      requiredCount: 1,
      uploadedAttachments: [{
        fileId: 'file-gm-1',
        originalName: 'uploaded-wave.csv',
        relPath: '.uploads/run/uploaded-wave.csv',
        mimeType: 'text/csv',
      }],
      records: [{
        id: 'file-gm-1',
        name: 'uploaded-wave.csv',
        recordType: 'actual',
        source: 'uploaded_attachment',
        headers: ['time', 'accel'],
        rows: [['0.00', '0.00'], ['0.02', '0.01'], ['0.04', '-0.01']],
      }],
    });
  });

  test('exposes uploaded ground-motion records as context when no workflow is provided', async () => {
    const { extractContextSeismicWorkflow } = await import('../../../dist/agent-langgraph/agent-service.js');

    const result = extractContextSeismicWorkflow(undefined, [{
      attachment: {
        fileId: 'file-gm-2',
        originalName: 'el-centro.csv',
        relPath: '.uploads/run/el-centro.csv',
        mimeType: 'text/csv',
      },
      analysis: {
        success: true,
        type: 'csv',
        headers: ['time', 'acceleration'],
        rows: Array.from({ length: 1560 }, (_, index) => [
          (index * 0.02).toFixed(2),
          index % 2 === 0 ? '0.01' : '-0.01',
        ]),
        totalLines: 1561,
        truncated: false,
      },
    }]);

    expect(result?.groundMotionSet).toMatchObject({
      source: 'uploaded',
      uploadedAttachments: [{
        fileId: 'file-gm-2',
        originalName: 'el-centro.csv',
        relPath: '.uploads/run/el-centro.csv',
        mimeType: 'text/csv',
      }],
    });
    const records = result?.groundMotionSet.records;
    expect(Array.isArray(records)).toBe(true);
    expect(records[0].rows).toHaveLength(1560);
    expect(records[0].fileAnalysis.rows).toBeUndefined();
  });
});
