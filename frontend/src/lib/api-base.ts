/**
 * Resolve the API base URL for browser-side fetch calls.
 *
 * In installed-package mode the frontend is served by the backend on the
 * same origin, so we use a relative path ('') — no CORS needed.
 *
 * In dev mode the frontend runs on a different port from the backend,
 * so we use NEXT_PUBLIC_API_URL or fall back to http://localhost:31415.
 * The normalizeBrowserApiBase helper ensures localhost → 127.0.0.1
 * for consistent CORS matching.
 */
const ENV_API_URL = process.env.NEXT_PUBLIC_API_URL || ''

/**
 * When the page is served by the backend itself (installed-package mode),
 * `window.location.origin` IS the backend URL.  We detect this by checking
 * that no explicit NEXT_PUBLIC_API_URL was set at build time.
 *
 * The empty-string return in installed-package mode is intentional: browser
 * fetch('') resolves to the current origin, so no CORS is needed.
 */
function resolveBrowserApiBase(): string {
  // If an explicit API URL was set at build time, use it
  if (ENV_API_URL) {
    return normalizeHostname(ENV_API_URL)
  }

  // No explicit URL → assume same-origin (installed-package mode)
  return ''
}

/** Normalize localhost → 127.0.0.1 for consistent CORS origin matching. */
function normalizeHostname(rawBase: string): string {
  try {
    const url = new URL(rawBase)
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return rawBase.replace(/\/$/, '')
  }
}

export const API_BASE = resolveBrowserApiBase()
