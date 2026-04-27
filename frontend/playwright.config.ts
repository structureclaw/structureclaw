import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/specs',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:31416',
    locale: 'en',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cd ../backend && npm run db:deploy && npm run build && node dist/index.js',
      port: 30010,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        PORT: '30010',
        DATABASE_URL: 'file:../../.runtime/data/test-e2e.db',
        LLM_API_KEY: process.env.LLM_API_KEY || '',
        LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',
        ...(process.env.LLM_BASE_URL ? { LLM_BASE_URL: process.env.LLM_BASE_URL } : {}),
      },
    },
    {
      command: 'npx next dev -p 31416',
      port: 31416,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:30010',
      },
    },
  ],
});
