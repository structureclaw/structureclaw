import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const __dirname = import.meta.dirname

const globalsCss = fs.readFileSync(path.resolve(__dirname, '../src/app/globals.css'), 'utf-8')

describe('Design Tokens (DSGN-01)', () => {
  it(':root should contain --background, --foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --destructive, --destructive-foreground, --border, --input, --ring', () => {
    const requiredVars = [
      '--background',
      '--foreground',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--accent-foreground',
      '--destructive',
      '--destructive-foreground',
      '--border',
      '--input',
      '--ring',
    ]

    for (const varName of requiredVars) {
      const regex = new RegExp(`:root[^}]*${varName}\\s*:`)
      expect(globalsCss).toMatch(regex)
    }
  })

  it('.dark selector should override all color variables with dark theme values', () => {
    const colorVars = [
      '--background',
      '--foreground',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--accent-foreground',
      '--destructive',
      '--destructive-foreground',
      '--border',
      '--input',
      '--ring',
    ]

    for (const varName of colorVars) {
      const regex = new RegExp(`\\.dark[^}]*${varName}\\s*:`)
      expect(globalsCss).toMatch(regex)
    }
  })

  it('--radius variable should be defined', () => {
    expect(globalsCss).toMatch(/--radius\s*:/)
  })

  it('Font CSS variables (--font-sans, --font-mono) should be defined as placeholders', () => {
    expect(globalsCss).toMatch(/--font-sans\s*:/)
    expect(globalsCss).toMatch(/--font-mono\s*:/)
  })
})
