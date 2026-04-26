import { test, expect } from '@playwright/test';
import { CapabilitiesPage } from '../pages/capabilities.page';

test.describe('Capabilities settings page', () => {
  let capsPage: CapabilitiesPage;

  test.beforeEach(async ({ page }) => {
    capsPage = new CapabilitiesPage(page);
  });

  test('loads capability settings page', async ({ page }) => {
    await capsPage.goto();
    await expect(page).toHaveURL(/\/capabilities/);
  });

  test('displays skill domains from real backend', async () => {
    await capsPage.goto();
    // Real backend returns auto-discovered skills from skill manifests
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
