import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeismicVisualReport } from '@/components/chat/seismic-visual-report'
import { messages, type MessageKey } from '@/lib/i18n'

const t = (key: MessageKey) => messages.zh[key]

const seismicResult = {
  analysis: {
    meta: { analysisType: 'seismic' },
    data: {
      summary: {
        groundMotionRecordCount: 2,
        maxBaseShear: 132.7,
        modalCount: 3,
      },
      designBasis: {
        intensity: 7,
        characteristicPeriod: 0.4,
      },
      methodDecision: {
        selectedMethods: ['response_spectrum', 'time_history'],
      },
      responseSpectrum: {
        designSpectrum: [
          { period: 0, alpha: 0.036 },
          { period: 0.1, alpha: 0.08 },
          { period: 0.4, alpha: 0.08 },
          { period: 1.2, alpha: 0.028 },
        ],
        spectrumAtModes: [
          { modeNumber: 1, period: 0.36, alpha: 0.08 },
        ],
        finalCompliance: {
          driftRatio: 0.0007,
          limitDriftRatio: 0.0018,
          status: 'pass',
          clause: 'GB/T 50011 5.5.1',
        },
        modalCombination: 'cqc',
        baseShear: 120.5,
      },
      elasticStoryDriftFinalCompliance: {
        limitDriftRatio: 0.0018,
        status: 'pass',
        clause: 'GB/T 50011 5.5.1',
      },
      timeHistory: {
        maxStoryDriftRatio: 0.0009,
        envelopeBaseShear: 132.7,
        baseShearCheck: {
          responseSpectrumBaseShear: 120.5,
        },
        records: [
          {
            name: 'El Centro NS.csv',
            pointCount: 3,
            baseShear: 126,
            preview: {
              unit: 'g',
              pointCount: 3,
              sampledPointCount: 3,
              points: [
                { time: 0, accelG: 0 },
                { time: 0.02, accelG: 0.03 },
                { time: 0.04, accelG: -0.02 },
              ],
            },
          },
        ],
        spectrumMatch: {
          maxScaleFactor: 1.1,
          averageModalSpectrumMinRatioToTarget: 0.92,
          modalSpectrumAverageOk: true,
          periodChecks: [
            { period: 0.36, averageRatioToTarget: 0.91 },
          ],
        },
      },
      groundMotionRequirement: {
        providedCount: 2,
        requiredCount: 2,
        status: 'satisfied',
      },
    },
  },
  report: {
    json: {
      codeCheck: {
        summary: {
          total: 3,
          passed: 3,
          failed: 0,
          warnings: 0,
        },
      },
      clauseTraceability: [
        {
          item: '构件抗震承载力',
          check: '构件抗震承载力',
          clause: 'GB/T 50011 6.2',
        },
      ],
    },
  },
}

describe('SeismicVisualReport', () => {
  it('does not render for non-seismic results', () => {
    render(
      <SeismicVisualReport
        result={{ analysis: { meta: { analysisType: 'linear_static' } } }}
        t={t}
        locale="zh"
      />
    )

    expect(screen.queryByTestId('seismic-visual-report')).not.toBeInTheDocument()
  })

  it('renders response-spectrum, time-history, and code-check evidence for seismic results', () => {
    render(
      <SeismicVisualReport
        result={seismicResult}
        t={t}
        locale="zh"
      />
    )

    expect(screen.getByTestId('seismic-visual-report')).toBeInTheDocument()
    expect(screen.getByText('抗震可视化摘要')).toBeInTheDocument()
    expect(screen.getByText('反应谱分析证据')).toBeInTheDocument()
    expect(screen.getByText('时程分析证据')).toBeInTheDocument()
    expect(screen.getByText('规范校核证据矩阵')).toBeInTheDocument()
    expect(screen.getAllByText('反应谱 + 时程分析')).toHaveLength(2)
    expect(screen.getAllByText('El Centro NS').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3 / 3').length).toBeGreaterThan(0)
    expect(screen.queryByText('未通过')).not.toBeInTheDocument()
  })
})
