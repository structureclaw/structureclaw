import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Custom Accent Color (DSGN-06)', () => {
  const globalsPath = path.resolve(__dirname, '../src/app/globals.css')
  let cssContent: string

  beforeAll(() => {
    cssContent = fs.readFileSync(globalsPath, 'utf-8')
  })

  it('should define --accent CSS variable in :root', () => {
    expect(cssContent).toMatch(/--accent:\s*\d+\s+\d+%\s+\d+%/)
  })

  it('should define --accent-foreground CSS variable in :root', () => {
    expect(cssContent).toMatch(/--accent-foreground:\s*\d+\s+\d+%\s+\d+%/)
  })

  it('should override accent colors in .dark selector', () => {
    // Find .dark block and check for accent variables
    const darkMatch = cssContent.match(/\.dark\s*\{([^}]+)\}/)
    expect(darkMatch).toBeTruthy()
    expect(darkMatch![1]).toMatch(/--accent:/)
  })

  it('should have accent color defined in @theme block', () => {
    expect(cssContent).toMatch(/--color-accent:\s*hsl\(var\(--accent\)\)/)
    expect(cssContent).toMatch(/--color-accent-foreground:\s*hsl\(var\(--accent-foreground\)\)/)
  })
})
