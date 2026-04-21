import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'
import MarketingLayout from '@/app/(marketing)/layout'
import ConsoleLayout from '@/app/(console)/layout'

describe('Route Groups (LAYT-03)', () => {
  describe('Marketing Layout', () => {
    it('marketing layout exists at app/(marketing)/layout.tsx', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/(marketing)/layout.tsx')
      expect(existsSync(layoutPath)).toBe(true)
    })

    it('marketing layout renders children', () => {
      render(
        <MarketingLayout>
          <div data-testid="child-content">Test Content</div>
        </MarketingLayout>
      )
      expect(screen.getByTestId('child-content')).toBeInTheDocument()
    })

    it('marketing layout has minimal header without sidebar', () => {
      render(
        <MarketingLayout>
          <div>Content</div>
        </MarketingLayout>
      )
      expect(screen.getByRole('banner')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open Console' })).toBeInTheDocument()
    })
  })

  describe('Console Layout', () => {
    it('console layout exists at app/(console)/layout.tsx', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/(console)/layout.tsx')
      expect(existsSync(layoutPath)).toBe(true)
    })

    it('console layout brand links back to home', () => {
      render(
        <ConsoleLayout>
          <div>Console Content</div>
        </ConsoleLayout>
      )
      expect(screen.getByRole('link', { name: /structureclaw conversational engineering ai/i })).toHaveAttribute('href', '/')
    })

    it('console layout includes language toggle', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/(console)/layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain('LanguageToggle')
    })

    it('console layout includes theme toggle', () => {
      const layoutPath = path.join(process.cwd(), 'src/app/(console)/layout.tsx')
      const content = readFileSync(layoutPath, 'utf-8')
      expect(content).toContain('ThemeToggle')
    })

    it('console layout links to the global LLM settings page', () => {
      render(
        <ConsoleLayout>
          <div>Console Content</div>
        </ConsoleLayout>
      )
      expect(screen.getByRole('link', { name: 'LLM' })).toHaveAttribute('href', '/console/llm')
    })
  })

  describe('Route Group URLs', () => {
    it('marketing page exists at app/(marketing)/page.tsx for / route', () => {
      const pagePath = path.join(process.cwd(), 'src/app/(marketing)/page.tsx')
      expect(existsSync(pagePath)).toBe(true)
    })

    it('console page exists at app/(console)/console/page.tsx for /console route', () => {
      const pagePath = path.join(process.cwd(), 'src/app/(console)/console/page.tsx')
      expect(existsSync(pagePath)).toBe(true)
    })
  })
})
