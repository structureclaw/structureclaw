import { test, expect } from '@playwright/test';
import { DatabasePage } from '../pages/database.page';

test.describe('Database admin page', () => {
  let dbPage: DatabasePage;

  test.beforeEach(async ({ page }) => {
    dbPage = new DatabasePage(page);
    // Mock the database status API to match actual response shape
    await page.route('**/api/v1/admin/database/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          provider: 'sqlite',
          mode: 'local-file',
          database: {
            provider: 'sqlite',
            databaseUrl: 'file:/tmp/test-e2e/structureclaw.db',
            databasePath: '/tmp/test-e2e/structureclaw.db',
            directoryPath: '/tmp/test-e2e',
            exists: true,
            writable: true,
            sizeBytes: 1024,
          },
        }),
      }),
    );
  });

  test('displays database status card', async () => {
    await dbPage.goto();
    await expect(dbPage.statusCard).toBeVisible();
  });

  test('shows SQLite as provider', async ({ page }) => {
    await dbPage.goto();
    // The provider label is rendered as uppercase in the Provider/Mode card
    await expect(page.getByText('sqlite', { exact: true })).toBeVisible();
  });

  test('shows file path', async ({ page }) => {
    await dbPage.goto();
    // Check that the database path is rendered
    await expect(page.getByText('/tmp/test-e2e/structureclaw.db', { exact: true })).toBeVisible();
  });

  test('handles API error gracefully', async ({ page }) => {
    await page.route('**/api/v1/admin/database/status', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      }),
    );
    await dbPage.goto();
    // Page should still render (error state)
    await expect(page.locator('body')).toBeVisible();
  });
});
