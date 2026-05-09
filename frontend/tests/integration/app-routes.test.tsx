import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import HomePage from '@/app/page'
import { AppStoreProvider } from '@/lib/stores/context'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const srcAppDir = path.resolve(testDir, '../../src/app')

describe('App Routes (LAYT-03)', () => {
  it('current app route files exist', () => {
    expect(existsSync(path.join(srcAppDir, 'page.tsx'))).toBe(true)
    expect(existsSync(path.join(srcAppDir, 'database/page.tsx'))).toBe(true)
    expect(existsSync(path.join(srcAppDir, 'llm/page.tsx'))).toBe(true)
    expect(existsSync(path.join(srcAppDir, 'capabilities/page.tsx'))).toBe(true)
  })

  it('root layout owns providers, main landmark, and workspace settings dialog', () => {
    const layoutPath = path.join(srcAppDir, 'layout.tsx')
    const content = readFileSync(layoutPath, 'utf-8')

    expect(content).toContain('Providers')
    expect(content).toContain('<main')
    expect(content).toContain('WorkspaceSettingsDialog')
  })

  it('root page renders the console workspace', async () => {
    Element.prototype.scrollIntoView = () => {}
    render(
      <AppStoreProvider>
        <HomePage />
      </AppStoreProvider>
    )

    expect(await screen.findByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
    expect(screen.getByTestId('console-layout-grid')).toBeInTheDocument()
  })
})
