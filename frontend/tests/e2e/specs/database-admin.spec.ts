import { test, expect } from '@playwright/test';
import { DatabasePage } from '../pages/database.page';

test.describe('Database admin page', () => {
  let dbPage: DatabasePage;

  test.beforeEach(async ({ page }) => {
    dbPage = new DatabasePage(page);
    // Mock the database status API
    await page.route('**/api/v1/admin/database/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'enabled',
          provider: 'sqlite',
          mode: 'file',
          filePath: '/tmp/test-e2e/structureclaw.db',
          directory: '/tmp/test-e2e',
          fileExists: true,
          writable: true,
          fileSize: 1024,
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
    await expect(page.locator('text=sqlite')).toBeVisible();
  });

  test('shows file path', async ({ page }) => {
    await dbPage.goto();
    await expect(page.locator('text=/tmp/test-e2e/structureclaw.db')).toBeVisible();
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
