import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * api-base.ts exports a single constant `API_BASE` that is computed at module
 * load time by `normalizeBrowserApiBase`. Because it is a module-level
 * side-effect we cannot easily re-run the function with different env/window
 * values. Instead we test the underlying logic by re-importing the module
 * under controlled conditions.
 *
 * Strategy:
 *  - Spy on `process.env.NEXT_PUBLIC_API_URL` via vi.stubEnv
 *  - Control `window` presence via jsdom (always present in jsdom env)
 *  - Verify the exported `API_BASE` value after re-import
 */

describe('api-base', () => {
  const baseUrl = 'http://localhost:8000'

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', baseUrl)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rewrites localhost to 127.0.0.1 in browser context', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000')
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000')
  })

  it('strips trailing slash from resolved URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/')
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000')
  })

  it('keeps non-localhost hostnames unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://example.com:3000/api')
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://example.com:3000/api')
  })

  it('keeps IP-based hostnames unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://192.168.1.10:8000')
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://192.168.1.10:8000')
  })

  it('returns raw value for unparseable URLs', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'not-a-valid-url')
    const { API_BASE } = await import('@/lib/api-base')
    // The catch block returns rawBase as-is for invalid URLs
    expect(API_BASE).toBe('not-a-valid-url')
  })

  it('defaults to http://localhost:8000 when env var is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '')
    // When the env var is empty string, the || fallback kicks in
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000')
  })

  it('handles localhost URL without port', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost')
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1')
  })

  it('handles localhost with path and trailing slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/api/')
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://127.0.0.1:8000/api')
  })

  it('returns the raw value when window is undefined (SSR)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:9000')
    // Simulate SSR by stubbing window to undefined. vi.stubGlobal handles
    // restoration via afterEach's vi.unstubAllGlobals.
    vi.stubGlobal('window', undefined)
    const { API_BASE } = await import('@/lib/api-base')
    expect(API_BASE).toBe('http://localhost:9000')
  })
})
