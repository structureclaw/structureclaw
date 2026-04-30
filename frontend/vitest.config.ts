import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const __dirname = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: [
      'tests/integration/**',
      'tests/components/console/**',
      'tests/accessibility/**',
      'tests/e2e/**',
    ],
    setupFiles: ['./tests/setup.ts'],
    // Windows CI and local runs are slower; userEvent + waitFor need headroom.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Console tests spy on global fetch; parallel files clobber each other's mock.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
