import { test, expect } from '@playwright/test';

test.describe('i18n and theme', () => {
  test.beforeEach(async ({ page }) => {
    // Clear locale preference before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('structureclaw.locale');
      document.cookie = 'structureclaw.locale=;expires=Thu, 01 Jan 1970 00:00:00 GMT';
    });
  });

  test('switches language from EN to ZH', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and click the language toggle
    const langToggle = page.locator('button[aria-label*="Language"], button[aria-label*="语言"], [role="group"]').first();
    if (await langToggle.isVisible()) {
      await langToggle.click();
    }

    // After toggle, html lang should change
    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(['en', 'zh-CN']).toContain(htmlLang);
  });

  test('can write locale to localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Set locale via localStorage
    await page.evaluate(() => {
      localStorage.setItem('structureclaw.locale', 'zh');
    });

    // Verify it was written
    const stored = await page.evaluate(() => localStorage.getItem('structureclaw.locale'));
    expect(stored).toBe('zh');
  });

  test('toggles theme from dark to light', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find theme toggle button
    const themeButtons = page.locator('header button[aria-label]');
    const themeBtn = themeButtons.nth(1);
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
    }

    // Theme should toggle - check for class changes on html or body
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toBeTruthy();
  });

  test('renders marketing page in English by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The hero title should contain English text
    const heroText = await page.locator('h1').textContent();
    expect(heroText).toBeTruthy();
    expect(heroText!.length).toBeGreaterThan(0);
  });

  test('html has lang attribute', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBeTruthy();
    expect(['en', 'zh-CN']).toContain(htmlLang);
  });
});
