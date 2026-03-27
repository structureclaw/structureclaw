import type { AppLocale } from '@/lib/stores/slices/preferences'

/** Same key for localStorage and document cookie so preferences stay aligned. */
export const LOCALE_STORAGE_KEY = 'structureclaw.locale'
export const LOCALE_COOKIE_NAME = LOCALE_STORAGE_KEY

export function normalizeLocale(value: unknown): AppLocale | null {
  if (value === 'en' || value === 'zh') {
    return value
  }
  return null
}

export function parseLocaleCookieValue(raw: string | undefined | null): AppLocale {
  return normalizeLocale(raw) ?? 'en'
}

/** Client: persist locale for the next full page request (SSR reads this cookie). */
export function writeLocaleCookie(locale: AppLocale): void {
  if (typeof document === 'undefined') {
    return
  }
  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${maxAge}; SameSite=Lax`
}

/** Client: read our locale cookie from document.cookie (first navigation after SSR). */
export function readLocaleCookieFromDocument(): AppLocale | null {
  if (typeof document === 'undefined') {
    return null
  }
  const prefix = `${LOCALE_COOKIE_NAME}=`
  const part = document.cookie.split('; ').find((row) => row.startsWith(prefix))
  if (!part) {
    return null
  }
  return normalizeLocale(decodeURIComponent(part.slice(prefix.length)))
}

/** Test / isolated environments: remove locale cookie so localStorage + provider initialState win. */
export function clearLocaleCookie(): void {
  if (typeof document === 'undefined') {
    return
  }
  document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`
}
