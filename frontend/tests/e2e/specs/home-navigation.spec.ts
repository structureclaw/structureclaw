import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home.page';

test.describe('Home page navigation', () => {
  let home: HomePage;

  test.beforeEach(async ({ page }) => {
    home = new HomePage(page);
    await home.goto();
  });

  test('displays hero section with CTA button', async () => {
    await expect(home.heroTitle).toBeVisible();
    await expect(home.enterConsoleButton.first()).toBeVisible();
  });

  test('navigates to console via header link', async ({ page }) => {
    await home.openConsoleLink.click();
    await expect(page).toHaveURL(/\/console/);
  });

  test('navigates to console via CTA button', async ({ page }) => {
    await home.enterConsoleButton.first().click();
    await expect(page).toHaveURL(/\/console/);
  });

  test('shows feature cards in workflow section', async () => {
    await expect(home.featureCards).toHaveCount(3);
  });

  test('shows quick prompt cards', async () => {
    const count = await home.promptCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
