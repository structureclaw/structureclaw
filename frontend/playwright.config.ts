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
    baseURL: 'http://localhost:30000',
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
        LLM_PROVIDER: 'openai',
        LLM_API_KEY: 'test-key-for-e2e',
        LLM_MODEL: 'gpt-4o-mini',
        REDIS_URL: 'disabled',
      },
    },
    {
      command: 'npx next dev -p 30000',
      port: 30000,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:30010',
      },
    },
  ],
});
