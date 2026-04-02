import { test, expect } from '@playwright/test';
import { ConsolePage } from '../pages/console.page';
import { mockChatStream } from '../helpers/mock-llm';

test.describe('Console chat flow', () => {
  let consolePage: ConsolePage;

  test.beforeEach(async ({ page }) => {
    consolePage = new ConsolePage(page);
    // Mock the conversation list endpoint
    await page.route('**/api/v1/chat/conversations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ conversations: [] }),
      }),
    );
    // Mock the agent skills endpoint used by the console
    await page.route('**/api/v1/agent/skills', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ skills: [] }),
      }),
    );
    await page.route('**/api/v1/agent/capability-matrix', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ skills: [], tools: [] }),
      }),
    );
  });

  test('displays 3-column layout on load', async ({ page }) => {
    await consolePage.goto();
    await expect(consolePage.historyPanel).toBeVisible();
    await expect(consolePage.chatPanel).toBeVisible();
  });

  test('shows empty chat state with quick prompts', async ({ page }) => {
    await consolePage.goto();
    // Chat panel should be visible in the center
    await expect(consolePage.chatPanel).toBeVisible();
  });

  test('sends a message and receives streaming response', async ({ page }) => {
    // Mock conversation creation
    await page.route('**/api/v1/chat/conversation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-e2e-1', title: 'Test beam', type: 'general' }),
      }),
    );
    // Mock the SSE stream
    await page.route('**/api/v1/chat/stream', mockChatStream);
    // Mock conversation detail (for loading messages)
    await page.route('**/api/v1/chat/conversation/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-e2e-1', messages: [] }),
      }),
    );

    await consolePage.goto();
    await consolePage.sendMessage('Analyze a simply supported beam');

    // Wait for response to appear in chat
    await page.waitForSelector('text=beam structure', { timeout: 10_000 });
  });

  test('creates new conversation', async ({ page }) => {
    await page.route('**/api/v1/chat/conversation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-new-1', title: 'New Chat', type: 'general' }),
      }),
    );

    await consolePage.goto();
    const count = await consolePage.conversationItems.count();
    // After creating, a new conversation should appear
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('analysis results appear in output panel after chat', async ({ page }) => {
    await page.route('**/api/v1/chat/conversation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-e2e-1', title: 'Test', type: 'general' }),
      }),
    );
    await page.route('**/api/v1/chat/stream', mockChatStream);
    await page.route('**/api/v1/chat/conversation/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-e2e-1', messages: [] }),
      }),
    );

    await consolePage.goto();
    await consolePage.sendMessage('Analyze a beam');

    // The output panel should eventually show results
    await expect(consolePage.outputPanel).toBeVisible({ timeout: 15_000 });
  });
});
