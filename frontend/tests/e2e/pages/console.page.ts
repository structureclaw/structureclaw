import type { Page, Locator } from '@playwright/test';

export class ConsolePage {
  readonly page: Page;
  readonly historyPanel: Locator;
  readonly chatPanel: Locator;
  readonly outputPanel: Locator;
  readonly collapseHistoryButton: Locator;
  readonly expandHistoryButton: Locator;
  readonly newConversationButton: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly quickPrompts: Locator;
  readonly conversationItems: Locator;
  readonly streamingIndicator: Locator;
  readonly analysisTab: Locator;
  readonly reportTab: Locator;
  readonly openVisualizationButton: Locator;
  readonly capabilityBar: Locator;
  readonly showResultsButton: Locator;
  readonly stopStreamButton: Locator;
  readonly assistantMessages: Locator;
  readonly visualizationModalScene: Locator;
  readonly visualizationModalPlaceholder: Locator;

  constructor(page: Page) {
    this.page = page;
    this.historyPanel = page.locator('[data-testid="console-history-panel"]');
    this.chatPanel = page.locator('[data-testid="console-chat-panel"]');
    this.outputPanel = page.locator('[data-testid="console-output-panel"]');
    this.collapseHistoryButton = page.getByRole('button', { name: /Collapse History|收起历史/ }).first();
    this.expandHistoryButton = page.getByRole('button', { name: /Expand History|展开历史/ }).first();
    this.newConversationButton = page.locator('button:has-text("New"), button:has-text("新建")');
    this.messageInput = page.locator('[data-testid="console-composer"] textarea, textarea[placeholder]');
    this.sendButton = page.getByRole('button', { name: /Send|发送/ });
    this.quickPrompts = page.locator('[data-testid="console-chat-panel"] button');
    this.conversationItems = page.locator('[data-testid="console-history-scroll"] > *');
    this.streamingIndicator = page.locator('.animate-pulse, [class*="streaming"]');
    this.analysisTab = page.locator('button:has-text("Analysis"), button:has-text("分析")');
    this.reportTab = page.locator('button:has-text("Report"), button:has-text("报告")');
    this.openVisualizationButton = page.locator('button:has-text("Visualization"), button:has-text("可视化")');
    this.capabilityBar = page.locator('[data-testid="console-composer"] [class*="capability"]');
    this.showResultsButton = page.locator('[data-testid="console-composer"] button:has-text("Show Results"), [data-testid="console-composer"] button:has-text("显示结果")');
    this.stopStreamButton = page.locator('button[class*="rose"]:has-text("Stop"), button[class*="rose"]:has-text("停止")');
    this.assistantMessages = page.locator('[data-testid="assistant-execution-group"]');
    this.visualizationModalScene = page.locator('[data-testid="visualization-modal-scene"]');
    this.visualizationModalPlaceholder = page.locator('[data-testid="visualization-modal-placeholder"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async sendMessage(text: string): Promise<void> {
    await this.messageInput.fill(text);
    await this.sendButton.click();
  }

  async sendMessageAndWaitForStream(text: string, timeoutMs = 90_000): Promise<void> {
    const streamPromise = this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/chat/stream') && resp.status() === 200,
      { timeout: timeoutMs },
    );
    await this.messageInput.fill(text);
    await this.sendButton.click();
    await streamPromise;
    await this.assistantMessages.first().waitFor({ state: 'visible', timeout: 150_000 });
    // Wait for the stream to finish by watching for "Show Results" / "显示结果" button
    // This button appears when results are available (stream done, not idle)
    await this.showResultsButton.first().waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async openResultDialog(): Promise<void> {
    await this.showResultsButton.first().click();
  }

  async openVisualization(): Promise<void> {
    await this.openVisualizationButton.first().click();
    await this.page.locator(
      '[data-testid="visualization-modal-scene"], [data-testid="visualization-modal-placeholder"]',
    ).first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  async closeVisualization(): Promise<void> {
    const closeButton = this.page.getByRole('button', {
      name: /Close Visualization|关闭可视化|Close/,
    });
    await closeButton.first().click();
    await this.page.locator(
      '[data-testid="visualization-modal-scene"], [data-testid="visualization-modal-placeholder"]',
    ).first().waitFor({ state: 'hidden', timeout: 10_000 });
  }

  async getConversationCount(): Promise<number> {
    return this.conversationItems.count();
  }
}
