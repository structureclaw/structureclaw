import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

describe('PostCSS/Tailwind pipeline guard', () => {
  it('has postcss.config.js with @tailwindcss/postcss plugin', () => {
    const configPath = path.resolve(__dirname, '../postcss.config.js')
    expect(fs.existsSync(configPath)).toBe(true)

    const content = fs.readFileSync(configPath, 'utf-8')
    expect(content).toContain('@tailwindcss/postcss')
  })

  it('globals.css uses Tailwind CSS v4 @import syntax', () => {
    const globalsPath = path.resolve(__dirname, '../src/app/globals.css')
    const css = fs.readFileSync(globalsPath, 'utf-8')

    expect(css).toContain("@import 'tailwindcss';")
  })
})
