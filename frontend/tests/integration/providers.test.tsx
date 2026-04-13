import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'
import { Providers } from '@/app/providers'

// next-themes ThemeProvider requires matchMedia in jsdom
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe('Provider Composition (LAYT-04)', () => {
  describe('Providers Component', () => {
    it('Providers wraps AppStoreProvider', () => {
      const providersPath = path.join(process.cwd(), 'src/app/providers.tsx')
      const content = readFileSync(providersPath, 'utf-8')
      expect(content).toContain('AppStoreProvider')
    })

    it('Providers wraps ThemeProvider', () => {
      const providersPath = path.join(process.cwd(), 'src/app/providers.tsx')
      const content = readFileSync(providersPath, 'utf-8')
      expect(content).toContain('ThemeProvider')
    })

    it('Providers includes Toaster component', () => {
      const providersPath = path.join(process.cwd(), 'src/app/providers.tsx')
      const content = readFileSync(providersPath, 'utf-8')
      expect(content).toContain('Toaster')
    })

    it('Providers renders children correctly', () => {
      render(
        <Providers>
          <div data-testid="test-child">Test Child</div>
        </Providers>
      )
      expect(screen.getByTestId('test-child')).toBeInTheDocument()
    })
  })

  describe('Root Layout Integration', () => {
    it('Root layout uses Providers wrapper', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain('Providers')
    })

    it('Root layout imports Providers from providers module', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain("from './providers'")
    })

    it('Root layout file exists', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/layout.tsx')
      expect(existsSync(layoutPath)).toBe(true)
    })
  })
})
