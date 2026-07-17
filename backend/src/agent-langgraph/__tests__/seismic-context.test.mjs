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

  test('filters non-ground-motion attachment tables out of seismic workflow context', async () => {
    const { extractContextSeismicWorkflow } = await import('../../../dist/agent-langgraph/agent-service.js');

    const result = extractContextSeismicWorkflow(undefined, [{
      attachment: {
        fileId: 'file-gm-1',
        originalName: 'el-centro.csv',
        relPath: '.uploads/run/el-centro.csv',
        mimeType: 'text/csv',
      },
      analysis: {
        success: true,
        type: 'csv',
        headers: ['time', 'accel_g'],
        rows: [['0.00', '0.00'], ['0.02', '0.01'], ['0.04', '-0.01']],
      },
    }, {
      attachment: {
        fileId: 'file-load-1',
        originalName: 'story-loads.csv',
        relPath: '.uploads/run/story-loads.csv',
        mimeType: 'text/csv',
      },
      analysis: {
        success: true,
        type: 'csv',
        headers: ['story', 'dead_load', 'live_load'],
        rows: [['F1', '5', '2'], ['F2', '5', '2'], ['F3', '5', '2']],
      },
    }, {
      attachment: {
        fileId: 'file-numeric-load-1',
        originalName: 'numeric-load-table.csv',
        relPath: '.uploads/run/numeric-load-table.csv',
        mimeType: 'text/csv',
      },
      analysis: {
        success: true,
        type: 'csv',
        headers: ['1', '10', '20'],
        rows: [['2', '12', '22'], ['3', '14', '24'], ['4', '16', '26']],
      },
    }, {
      attachment: {
        fileId: 'file-zoning-1',
        originalName: 'gb18306-zoning.xlsx',
        relPath: '.uploads/run/gb18306-zoning.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      analysis: {
        success: true,
        type: 'excel',
        sheets: {
          Sheet1: {
            headers: ['region', 'intensity', 'designGroup', 'siteCategory'],
            rows: [['北京', '8', '2', 'II'], ['上海', '7', '1', 'IV']],
          },
        },
      },
    }]);

    expect(result?.groundMotionSet.uploadedAttachments).toEqual([{
      fileId: 'file-gm-1',
      originalName: 'el-centro.csv',
      relPath: '.uploads/run/el-centro.csv',
      mimeType: 'text/csv',
    }]);
    expect(result?.groundMotionSet.records).toHaveLength(1);
    expect(result?.groundMotionSet.records[0]).toMatchObject({
      id: 'file-gm-1',
      name: 'el-centro.csv',
      source: 'uploaded_attachment',
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
