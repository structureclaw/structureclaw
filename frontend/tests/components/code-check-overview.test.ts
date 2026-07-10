import { describe, expect, it } from 'vitest'
import { extractCodeCheckOverview } from '@/components/chat/code-check-overview'

describe('extractCodeCheckOverview', () => {
  it('extracts summary, governing check, and attention items from report json', () => {
    const overview = extractCodeCheckOverview({
      report: {
        json: {
          codeCheck: {
            summary: {
              total: 4,
              passed: 1,
              failed: 1,
              warnings: 1,
              maxUtilization: 9999,
              controllingElement: '__global_seismic__',
              controllingCheck: 'Seismic capability boundary',
            },
            details: [{
              elementId: '__global_seismic__',
              checks: [{
                name: 'Global seismic check',
                items: [
                  { item: 'member capacity', status: 'pass', utilization: 0.72 },
                  { item: 'full nonlinear member model', status: 'fail', utilization: 9999, clause: 'GB 55002-2021', message: 'Boundary not implemented.' },
                  { item: 'vertical action capacity', status: 'not_applicable', utilization: 0 },
                  { item: 'ground motion scaling', status: 'warning', utilization: 1.9 },
                ],
              }],
            }],
          },
        },
      },
    }, 'en')

    expect(overview?.summary).toEqual({
      total: '4',
      passed: '1',
      failed: '1',
      warnings: '1',
      notApplicable: '1',
      status: 'failed',
    })
    expect(overview?.governing).toEqual({
      element: 'Global seismic workflow',
      check: 'Seismic capability boundary',
      utilization: 'N/A',
    })
    expect(overview?.attentionItems.map((item) => item.rawStatus)).toEqual(['fail', 'warning', 'not_applicable'])
    expect(overview?.attentionItems.map((item) => item.status)).toEqual(['Fail', 'Warning', 'Unavailable/N.A.'])
    expect(overview?.attentionItems[0]).toMatchObject({
      elementId: 'Global seismic workflow',
      scopeKind: 'global',
      check: 'Global seismic check',
      item: 'full nonlinear member model',
      clause: 'GB 55002-2021',
      utilization: 'N/A',
      message: 'Boundary not implemented.',
    })
  })

  it('falls back to top-level nested code-check data when report json has an empty shell', () => {
    const overview = extractCodeCheckOverview({
      report: { json: { codeCheck: {} } },
      codeCheck: {
        data: {
          summary: {
            total: '2',
            passed: '2',
            failed: '0',
            warnings: '0',
          },
          checks: [{
            check: 'Global drift',
            items: [{ item: 'elastic drift', status: 'pass', utilization: 0.48 }],
          }],
        },
      },
    }, 'zh')

    expect(overview?.summary?.status).toBe('passed')
    expect(overview?.summary?.total).toBe('2')
    expect(overview?.attentionItems).toEqual([])
  })

  it('unwraps result payloads and ignores skipped code checks', () => {
    expect(extractCodeCheckOverview({
      result: {
        report: {
          json: {
            codeCheck: {
              summary: { total: 1, passed: 0, failed: 0, warnings: 1 },
              checks: [{ check: 'Modal mass', status: 'warn', utilization: 1.2 }],
            },
          },
        },
      },
    }, 'en')?.summary?.status).toBe('warning')

    expect(extractCodeCheckOverview({
      report: {
        json: {
          codeCheck: { skipped: true, reason: 'No design code.' },
        },
      },
    }, 'en')).toBeNull()
  })

  it('marks explicit not-applicable summaries as attention instead of passed', () => {
    const overview = extractCodeCheckOverview({
      codeCheck: {
        summary: {
          total: 1,
          passed: 0,
          failed: 0,
          warnings: 0,
          notApplicable: 1,
        },
        details: [{
          elementId: 'W1',
          checks: [{
            name: 'Boundary element',
            items: [{ item: 'edge member data', status: 'not_applicable', utilization: 0 }],
          }],
        }],
      },
    }, 'en')

    expect(overview?.summary).toMatchObject({
      notApplicable: '1',
      status: 'warning',
    })
  })

  it('labels global input-required seismic failures without sentinel utilization', () => {
    const overview = extractCodeCheckOverview({
      codeCheck: {
        summary: {
          total: 43,
          passed: 42,
          failed: 1,
          warnings: 0,
          maxUtilization: 0,
          controllingElement: '__global_seismic__',
          controllingCheck: '地震波反应谱适配',
        },
        details: [{
          elementId: '__global_seismic__',
          checks: [{
            name: '时程分析输入与结果校核',
            items: [
              {
                item: '实际强震记录比例',
                status: 'fail',
                utilization: 0,
                displayUtilization: 'N/A',
                category: 'input_required',
                failureType: 'missing_actual_ground_motion_records',
              },
              {
                item: '时程方向级校核追踪',
                status: 'fail',
                utilization: 1.02,
                displayUtilization: 'N/A',
                category: 'diagnostic',
                failureType: 'time_history_direction_trace',
              },
            ],
          }],
        }],
      },
    }, 'zh')

    expect(overview?.governing).toEqual({
      element: '整体抗震流程',
      check: '地震波反应谱适配',
      utilization: '0',
    })
    expect(overview?.attentionItems).toEqual([
      expect.objectContaining({
        elementId: '整体抗震流程',
        scopeKind: 'global',
        status: '需补充资料',
        utilization: 'N/A',
      }),
      expect.objectContaining({
        elementId: '整体抗震流程',
        scopeKind: 'global',
        status: '诊断未通过',
        utilization: 'N/A',
      }),
    ])
  })
})
