import { test, expect } from '@playwright/test';
import { ConsolePage } from '../pages/console.page';

/**
 * Home page navigation tests.
 *
 * The root URL (/) renders the AIConsole component directly —
 * there is no separate landing page. These tests verify that the
 * console loads correctly at the root path.
 */
test.describe('Home page navigation', () => {
  let consolePage: ConsolePage;

  test.beforeEach(async ({ page }) => {
    consolePage = new ConsolePage(page);
  });

  test('loads console at root URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\//);
    await expect(consolePage.chatPanel).toBeVisible();
  });

  test('renders 3-column console layout', async () => {
    await consolePage.goto();
    await expect(consolePage.historyPanel).toBeVisible();
    await expect(consolePage.chatPanel).toBeVisible();
  });

  test('shows welcome heading and quick prompts in idle state', async ({ page }) => {
    await consolePage.goto();
    await expect(page.locator('h1')).toBeVisible();
    // Quick prompt buttons should be visible
    const promptButtons = page.locator('[data-testid="console-chat-panel"] button');
    await expect(promptButtons.first()).toBeVisible();
  });

  test('has text input for messages', async ({ page }) => {
    await consolePage.goto();
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
  });

  test('has history panel with conversation list', async () => {
    await consolePage.goto();
    const historyScroll = consolePage.page.locator('[data-testid="console-history-scroll"]');
    await expect(historyScroll).toBeVisible();
  });
});
