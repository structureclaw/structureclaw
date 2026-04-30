import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const __dirname = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'tests/integration/**/*.test.tsx',
      'tests/components/console/**/*.test.tsx',
      'tests/accessibility/semantic.test.tsx',
    ],
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/setup-integration.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
