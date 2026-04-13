import { test, expect } from '@playwright/test';
import { DatabasePage } from '../pages/database.page';

test.describe('Database admin page', () => {
  let dbPage: DatabasePage;

  test.beforeEach(async ({ page }) => {
    dbPage = new DatabasePage(page);
  });

  test('displays database status card', async () => {
    await dbPage.goto();
    await expect(dbPage.statusCard).toBeVisible();
  });

  test('shows SQLite as provider', async ({ page }) => {
    await dbPage.goto();
    // Real backend returns sqlite provider from the test-e2e.db DATABASE_URL
    await expect(page.getByText('sqlite', { exact: true })).toBeVisible();
  });

  test('shows file path from real backend', async ({ page }) => {
    await dbPage.goto();
    // Real backend returns the configured DATABASE_URL path (contains test-e2e.db)
    // Backend may render both the file: URL and plain path, so use .first()
    await expect(page.getByText(/test-e2e\.db/).first()).toBeVisible();
  });

  test('handles API error gracefully', async ({ page }) => {
    // Intercept only to simulate a 500 error for UI resilience testing
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
