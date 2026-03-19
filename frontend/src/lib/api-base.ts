const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function normalizeBrowserApiBase(rawBase: string) {
  if (typeof window === 'undefined') {
    return rawBase
  }

  try {
    const url = new URL(rawBase)
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
      return url.toString().replace(/\/$/, '')
    }
    return rawBase
  } catch {
    return rawBase
  }
}

export const API_BASE = normalizeBrowserApiBase(DEFAULT_API_BASE)
