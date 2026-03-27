import { describe, it, expect } from 'vitest'
import {
  LOCALE_COOKIE_NAME,
  parseLocaleCookieValue,
  readLocaleCookieFromDocument,
  normalizeLocale,
} from '@/lib/locale-preference'

describe('locale-preference', () => {
  it('parseLocaleCookieValue defaults to en', () => {
    expect(parseLocaleCookieValue(undefined)).toBe('en')
    expect(parseLocaleCookieValue(null)).toBe('en')
    expect(parseLocaleCookieValue('')).toBe('en')
    expect(parseLocaleCookieValue('xx')).toBe('en')
  })

  it('parseLocaleCookieValue accepts en and zh', () => {
    expect(parseLocaleCookieValue('en')).toBe('en')
    expect(parseLocaleCookieValue('zh')).toBe('zh')
  })

  it('normalizeLocale only accepts en and zh', () => {
    expect(normalizeLocale('zh')).toBe('zh')
    expect(normalizeLocale('bad')).toBeNull()
  })

  it('readLocaleCookieFromDocument parses document.cookie', () => {
    document.cookie = `${LOCALE_COOKIE_NAME}=zh; path=/`
    expect(readLocaleCookieFromDocument()).toBe('zh')
  })

  it('readLocaleCookieFromDocument returns null when missing', () => {
    document.cookie = 'other=1; path=/'
    expect(readLocaleCookieFromDocument()).toBeNull()
  })
})
