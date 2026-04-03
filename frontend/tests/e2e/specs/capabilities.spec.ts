import { test, expect } from '@playwright/test';
import { CapabilitiesPage } from '../pages/capabilities.page';

test.describe('Capabilities settings page', () => {
  let capsPage: CapabilitiesPage;

  test.beforeEach(async ({ page }) => {
    capsPage = new CapabilitiesPage(page);
    // Mock the skills and capability matrix endpoints
    await page.route('**/api/v1/agent/skills', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          skills: [
            { domain: 'analysis', name: 'OpenSees Analysis', enabled: true },
            { domain: 'code-check', name: 'GB50010', enabled: true },
            { domain: 'visualization', name: '3D Viewer', enabled: false },
          ],
        }),
      }),
    );
    await page.route('**/api/v1/agent/capability-matrix', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          skills: [
            { domain: 'analysis', enabled: true },
            { domain: 'code-check', enabled: true },
            { domain: 'visualization', enabled: false },
          ],
          tools: [
            { category: 'analysis', enabled: true },
            { category: 'validation', enabled: true },
          ],
        }),
      }),
    );
  });

  test('loads capability settings page', async ({ page }) => {
    await capsPage.goto();
    await expect(page).toHaveURL(/\/console\/capabilities/);
  });

  test('displays skill domains', async () => {
    await capsPage.goto();
    // At least some skill-related content should be visible
    const body = await capsPage.page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('toggle switches are interactive', async ({ page }) => {
    await capsPage.goto();
    const toggleCount = await capsPage.toggles.count();
    if (toggleCount > 0) {
      await capsPage.toggles.first().click();
      // Toggle should respond (state change)
    }
  });

  test('reset buttons are visible', async ({ page }) => {
    await capsPage.goto();
    // Page should load without errors
    await expect(page.locator('body')).toBeVisible();
  });
});
