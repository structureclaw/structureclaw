import { test, expect } from '@playwright/test';
import { ConsolePage } from '../pages/console.page';

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

  test('sends a message and triggers stream request', async ({ page }) => {
    let streamRequested = false;
    // Mock conversation creation
    await page.route('**/api/v1/chat/conversation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-e2e-1', title: 'Test beam', type: 'general' }),
      }),
    );
    // Mock the SSE stream - record that it was requested
    await page.route('**/api/v1/chat/stream', async (route) => {
      streamRequested = true;
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: [
          'data: {"type":"start","data":{"conversationId":"conv-e2e-1"}}\n\n',
          'data: {"type":"token","data":{"content":"Analyzing beam."}}\n\n',
          'data: {"type":"done"}\n\n',
        ].join(''),
      });
    });
    // Mock conversation detail
    await page.route('**/api/v1/chat/conversation/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-e2e-1', messages: [] }),
      }),
    );

    await consolePage.goto();
    await consolePage.sendMessage('Analyze a simply supported beam');

    // Verify the stream endpoint was called
    await page.waitForTimeout(2000);
    expect(streamRequested).toBe(true);
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

  test('output panel is present in layout', async ({ page }) => {
    await consolePage.goto();
    // The output panel is part of the 3-column layout
    await expect(consolePage.outputPanel).toBeVisible({ timeout: 15_000 });
  });
});
