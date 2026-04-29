import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Tailwind Configuration (DSGN-03)', () => {
  const globalsPath = path.resolve(__dirname, '../src/app/globals.css')
  let cssContent: string

  beforeAll(() => {
    cssContent = fs.readFileSync(globalsPath, 'utf-8')
  })

  it('should use Tailwind CSS v4 @import syntax', () => {
    expect(cssContent).toContain("@import 'tailwindcss';")
  })

  it('should define custom dark mode variant', () => {
    expect(cssContent).toMatch(/@custom-variant\s+dark/)
  })

  it('should define color tokens in @theme block referencing CSS variables', () => {
    expect(cssContent).toMatch(/--color-background:\s*hsl\(var\(--background\)\)/)
    expect(cssContent).toMatch(/--color-foreground:\s*hsl\(var\(--foreground\)\)/)
    expect(cssContent).toMatch(/--color-primary:\s*hsl\(var\(--primary\)\)/)
    expect(cssContent).toMatch(/--color-primary-foreground:\s*hsl\(var\(--primary-foreground\)\)/)
    expect(cssContent).toMatch(/--color-secondary:\s*hsl\(var\(--secondary\)\)/)
    expect(cssContent).toMatch(/--color-secondary-foreground:\s*hsl\(var\(--secondary-foreground\)\)/)
    expect(cssContent).toMatch(/--color-muted:\s*hsl\(var\(--muted\)\)/)
    expect(cssContent).toMatch(/--color-muted-foreground:\s*hsl\(var\(--muted-foreground\)\)/)
    expect(cssContent).toMatch(/--color-accent:\s*hsl\(var\(--accent\)\)/)
    expect(cssContent).toMatch(/--color-accent-foreground:\s*hsl\(var\(--accent-foreground\)\)/)
    expect(cssContent).toMatch(/--color-destructive:\s*hsl\(var\(--destructive\)\)/)
    expect(cssContent).toMatch(/--color-destructive-foreground:\s*hsl\(var\(--destructive-foreground\)\)/)
    expect(cssContent).toMatch(/--color-border:\s*hsl\(var\(--border\)\)/)
    expect(cssContent).toMatch(/--color-input:\s*hsl\(var\(--input\)\)/)
    expect(cssContent).toMatch(/--color-ring:\s*hsl\(var\(--ring\)\)/)
    expect(cssContent).toMatch(/--color-popover:\s*hsl\(var\(--popover\)\)/)
    expect(cssContent).toMatch(/--color-popover-foreground:\s*hsl\(var\(--popover-foreground\)\)/)
    expect(cssContent).toMatch(/--color-card:\s*hsl\(var\(--card\)\)/)
    expect(cssContent).toMatch(/--color-card-foreground:\s*hsl\(var\(--card-foreground\)\)/)
  })

  it('should define font family tokens in @theme block', () => {
    expect(cssContent).toMatch(/--font-sans:\s*var\(--font-sans\)/)
    expect(cssContent).toMatch(/--font-mono:\s*var\(--font-mono\)/)
  })
})
