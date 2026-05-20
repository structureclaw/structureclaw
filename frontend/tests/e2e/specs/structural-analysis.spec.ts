import { test, expect } from '@playwright/test';
import { ConsolePage } from '../pages/console.page';

const hasLlmKey = !!process.env.LLM_API_KEY;

test.describe('Structural analysis end-to-end', () => {
  let consolePage: ConsolePage;

  test.beforeEach(async ({ page }) => {
    consolePage = new ConsolePage(page);
  });

  test('EN: simply supported beam - complete analysis flow', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!hasLlmKey, 'Requires LLM_API_KEY');

    await consolePage.goto();
    const countBefore = await consolePage.getConversationCount();

    await consolePage.sendMessageAndWaitForStream(
      'Analyze a 6m simply supported beam with UDL of 20 kN/m. Use steel beam section.',
    );

    const countAfter = await consolePage.getConversationCount();
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);

    await expect(consolePage.showResultsButton).toBeVisible({ timeout: 15_000 });
    await consolePage.openResultDialog();
    await expect(consolePage.analysisTab.first()).toBeVisible({ timeout: 10_000 });
  });

  test('ZH: simply supported beam - complete analysis flow', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!hasLlmKey, 'Requires LLM_API_KEY');

    await consolePage.goto();
    await page.evaluate(() => {
      localStorage.setItem('structureclaw.locale', 'zh');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await consolePage.sendMessageAndWaitForStream(
      '分析一根6米简支梁，均布荷载20kN/m，使用钢梁截面。',
    );

    await expect(consolePage.showResultsButton).toBeVisible({ timeout: 15_000 });
    await consolePage.openResultDialog();
    await expect(consolePage.analysisTab.first()).toBeVisible({ timeout: 10_000 });
  });

  test('stream events are well-formed', async ({ request }) => {
    test.setTimeout(90_000);
    test.skip(!hasLlmKey, 'Requires LLM_API_KEY');

    const convResp = await request.post('/api/v1/chat/conversation', {
      data: { title: 'E2E stream test', type: 'analysis', locale: 'en' },
    });
    expect(convResp.status()).toBe(200);
    const conv = await convResp.json();
    const conversationId = conv.id ?? conv.conversationId;

    const streamResp = await request.post('/api/v1/chat/stream', {
      data: {
        message: 'Analyze a simply supported beam, 6m span, UDL 20kN/m',
        conversationId,
        traceId: `e2e-${Date.now()}`,
        context: { locale: 'en' },
      },
    });
    expect(streamResp.status()).toBe(200);

    const body = await streamResp.text();
    const eventTypes: string[] = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        try {
          const parsed = JSON.parse(trimmed.slice(5).trim());
          if (parsed.type) eventTypes.push(parsed.type);
        } catch {
          // skip non-JSON lines
        }
      }
    }

    expect(eventTypes).toContain('start');
    expect(eventTypes.some((t) => t === 'token' || t === 'result' || t === 'done')).toBe(true);
  });

  test('visualization opens from analysis result', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!hasLlmKey, 'Requires LLM_API_KEY');

    await consolePage.goto();
    await consolePage.sendMessageAndWaitForStream(
      'Analyze a 6m simply supported beam with UDL of 20 kN/m.',
    );

    await expect(consolePage.showResultsButton).toBeVisible({ timeout: 15_000 });
    await consolePage.openResultDialog();

    // Verify the result dialog opened with analysis content
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Try to open visualization if the button exists
    const visButton = page.locator(
      '[role="dialog"] button:has-text("Visualization"), [role="dialog"] button:has-text("可视化")',
    );
    if (await visButton.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await visButton.first().click();
      const sceneOrPlaceholder = page.locator(
        '[data-testid="visualization-modal-scene"], [data-testid="visualization-modal-placeholder"]',
      );
      await expect(sceneOrPlaceholder.first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('result persists after page reload', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!hasLlmKey, 'Requires LLM_API_KEY');

    await consolePage.goto();
    await consolePage.sendMessageAndWaitForStream(
      'Analyze a 6m simply supported beam with UDL of 20 kN/m.',
    );

    await expect(consolePage.showResultsButton).toBeVisible({ timeout: 15_000 });
    const countBefore = await consolePage.getConversationCount();
    expect(countBefore).toBeGreaterThan(0);

    await page.reload();
    await consolePage.historyPanel.waitFor({ state: 'visible' });

    const countAfter = await consolePage.getConversationCount();
    expect(countAfter).toBe(countBefore);
  });
});
