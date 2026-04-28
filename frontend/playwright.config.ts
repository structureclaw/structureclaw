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
    baseURL: 'http://localhost:31415',
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
  webServer: {
    command: 'npm run build && cd ../backend && npm run db:deploy && npm run build && node dist/index.js',
    port: 31415,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      DATABASE_URL: 'file:../../.structureclaw/data/test-e2e.db',
      SCLAW_FRONTEND_DIR: '../frontend/out',
      NEXT_PUBLIC_API_URL: '',
    },
  },
});
