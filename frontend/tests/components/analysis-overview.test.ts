import { describe, expect, it } from 'vitest'
import { extractSummaryStats } from '@/components/chat/ai-console'

const t = (key: string) => {
  if (key === 'analysisOverviewDirectionalTimeHistory') return 'Directional Time-History'
  if (key === 'analysisOverviewOverLimitSpecialReview') return 'Over-Limit/Special Review'
  if (key === 'analysisOverviewRequired') return 'Required'
  return key
}

const tZh = (key: string) => {
  if (key === 'analysisOverviewDirectionalTimeHistory') return '方向时程摘要'
  if (key === 'analysisOverviewOverLimitSpecialReview') return '超限/专项审查'
  if (key === 'analysisOverviewRequired') return '需要'
  return key
}

const analysis = {
  data: {
    directionResults: [
      {
        direction: 'x',
        timeHistory: {
          records: [
            { baseShearRatioToResponseSpectrum: 0.7 },
            { baseShearRatioToResponseSpectrum: 0.82 },
            { baseShearRatioToResponseSpectrum: 0.9 },
          ],
          combinationSummary: { combinedBaseShear: 140.5 },
        },
      },
      {
        direction: 'y',
        timeHistory: {
          records: [
            { baseShearRatioToResponseSpectrum: 0.72 },
            { baseShearRatioToResponseSpectrum: 0.84 },
            { baseShearRatioToResponseSpectrum: 0.91 },
          ],
          combinationSummary: { combinedBaseShear: 135.2 },
        },
      },
    ],
    overLimitReview: {
      reviewRequired: true,
      reviewType: 'over_limit_high_rise',
      status: 'approved',
      approvalId: 'SZ-REVIEW-2026-001',
    },
  },
}

describe('extractSummaryStats', () => {
  it('summarizes directional time-history traces in English', () => {
    const stats = extractSummaryStats(analysis, t, 'en')
    const directional = stats.find((item) => item.label === 'Directional Time-History')

    expect(directional?.value).toContain('x: 3 records / min 0.7 / 140.5 N')
    expect(directional?.value).toContain('y: 3 records / min 0.72 / 135.2 N')
  })

  it('summarizes directional time-history traces in Chinese', () => {
    const stats = extractSummaryStats(analysis, tZh, 'zh')
    const directional = stats.find((item) => item.label === '方向时程摘要')

    expect(directional?.value).toContain('x: 3条 / 最小 0.7 / 140.5 N')
    expect(directional?.value).toContain('y: 3条 / 最小 0.72 / 135.2 N')
  })

  it('summarizes structured over-limit review traces', () => {
    const stats = extractSummaryStats(analysis, t, 'en')
    const review = stats.find((item) => item.label === 'Over-Limit/Special Review')

    expect(review?.value).toBe('over_limit_high_rise / Required / approved / SZ-REVIEW-2026-001')
  })
})
