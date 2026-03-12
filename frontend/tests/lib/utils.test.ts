import { describe, expect, it } from 'vitest'
import { formatDate } from '@/lib/utils'

describe('locale-aware utils', () => {
  it('formats dates differently for English and Chinese locales', () => {
    const input = '2026-03-12T08:30:00.000Z'

    const english = formatDate(input, 'en')
    const chinese = formatDate(input, 'zh')

    expect(english).not.toBe(chinese)
    expect(chinese.startsWith('2026/')).toBe(true)
  })
})
