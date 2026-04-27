import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOCALE_COOKIE_NAME,
  readLocaleCookieFromDocument,
  normalizeLocale,
} from '@/lib/locale-preference'

function clearDocumentCookies() {
  for (const cookie of document.cookie.split('; ')) {
    if (!cookie) {
      continue
    }
    const [name] = cookie.split('=')
    document.cookie = `${name}=; path=/; max-age=0`
  }
}

describe('locale-preference', () => {
  beforeEach(() => {
    clearDocumentCookies()
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
