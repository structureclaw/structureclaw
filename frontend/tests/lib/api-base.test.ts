import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('API_BASE', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('rewrites localhost to 127.0.0.1 in the browser', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000')

    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000')
  })

  it('strips trailing slash after rewriting localhost', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/')

    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000')
  })

  it('returns non-localhost URLs unchanged in the browser', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://example.com:3000')

    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://example.com:3000')
  })

  it('returns the raw value when the URL cannot be parsed', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '::not-a-url')

    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('::not-a-url')
  })

  it('uses the default http://localhost:8000 when NEXT_PUBLIC_API_URL is not set', async () => {
    // Ensure the env variable is absent so the || fallback on line 1 is exercised
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined)

    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000')
  })

  it('returns the raw value when window is undefined (SSR)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:9000')
    // In jsdom, window is a non-configurable property on globalThis,
    // so we override it on the global object where the module checks `typeof window`.
    const originalWindow = globalThis.window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window

    try {
      const { API_BASE } = await import('@/lib/api-base')
      expect(API_BASE).toBe('http://localhost:9000')
    } finally {
      globalThis.window = originalWindow
    }
  })
})
