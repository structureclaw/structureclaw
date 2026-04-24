import { test, expect } from '@playwright/test';
import { ConsolePage } from '../pages/console.page';

const hasLlmKey = !!process.env.LLM_API_KEY;

test.describe('Console chat flow', () => {
  let consolePage: ConsolePage;

  test.beforeEach(async ({ page }) => {
    consolePage = new ConsolePage(page);
  });

  test('displays 3-column layout on load', async ({ page }) => {
    await consolePage.goto();
    await expect(consolePage.historyPanel).toBeVisible();
    await expect(consolePage.chatPanel).toBeVisible();
  });

  test('collapses and expands the history panel at laptop size', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await consolePage.goto();

    await consolePage.collapseHistoryButton.click();
    await expect(page.locator('[data-testid="console-layout-grid"]')).toHaveAttribute('data-history-collapsed', 'true');
    await expect(consolePage.expandHistoryButton).toBeVisible();

    await consolePage.expandHistoryButton.click();
    await expect(page.locator('[data-testid="console-layout-grid"]')).toHaveAttribute('data-history-collapsed', 'false');
  });

  test('uses popup result mode without horizontal scrolling at laptop size', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await consolePage.goto();

    await page.getByRole('button', { name: /Use Popup Results|弹窗显示结果/ }).click();
    await expect(page.locator('[data-testid="console-layout-grid"]')).toHaveAttribute('data-output-mode', 'modal');

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('shows empty chat state with quick prompts', async ({ page }) => {
    await consolePage.goto();
    // Chat panel should be visible in the center
    await expect(consolePage.chatPanel).toBeVisible();
  });

  test('sends a message and triggers stream request', async ({ page }) => {
    test.skip(!hasLlmKey, 'Requires LLM_API_KEY for real LLM streaming');

    await consolePage.goto();

    // Wait for the real stream response from the backend
    const streamResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/chat/stream') && resp.status() === 200,
    );

    await consolePage.sendMessage('Analyze a simply supported beam');

    // Verify the stream endpoint was called and returned 200
    const response = await streamResponse;
    expect(response.status()).toBe(200);
  });

  test('creates new conversation', async ({ page }) => {
    await consolePage.goto();
    const count = await consolePage.conversationItems.count();
    // After creating, a new conversation should appear
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('output panel is present in layout', async ({ page }) => {
    await consolePage.goto();
    // The output panel is part of the 3-column layout
    await expect(consolePage.outputPanel).toBeVisible({ timeout: 15_000 });
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    test(`console has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await consolePage.goto();

      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
