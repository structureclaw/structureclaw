import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Glassmorphism Effects (DSGN-07)', () => {
  const globalsPath = path.resolve(__dirname, '../src/app/globals.css')
  let cssContent: string

  beforeAll(() => {
    cssContent = fs.readFileSync(globalsPath, 'utf-8')
  })

  it('should define @utility glass', () => {
    expect(cssContent).toMatch(/@utility\s+glass\s*\{/)
  })

  it('should include backdrop-blur in glass utilities', () => {
    expect(cssContent).toMatch(/backdrop-blur/)
  })

  it('should define @utility glass-subtle variant', () => {
    expect(cssContent).toMatch(/@utility\s+glass-subtle\s*\{/)
  })

  it('should define @utility glass-strong variant', () => {
    expect(cssContent).toMatch(/@utility\s+glass-strong\s*\{/)
  })

  it('should include dark mode adjustments via @utility dark', () => {
    // Tailwind v4 uses @utility dark with nested & .glass selectors
    const darkUtilityMatch = cssContent.match(/@utility\s+dark\s*\{/)
    expect(darkUtilityMatch).toBeTruthy()

    // Verify the dark utility references glass classes
    const darkBlockMatch = cssContent.match(/@utility\s+dark\s*\{([^}]+(?:\{[^}]*\}[^}]*)+)\}/s)
    expect(darkBlockMatch).toBeTruthy()
    expect(darkBlockMatch![1]).toMatch(/&\s+\.glass/)
  })
})
