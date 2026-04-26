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

  constructor(page: Page) {
    this.page = page;
    this.historyPanel = page.locator('[data-testid="console-history-panel"]');
    this.chatPanel = page.locator('[data-testid="console-chat-panel"]');
    this.outputPanel = page.locator('[data-testid="console-output-panel"]');
    this.collapseHistoryButton = page.getByRole('button', { name: /Collapse History|收起历史/ }).first();
    this.expandHistoryButton = page.getByRole('button', { name: /Expand History|展开历史/ }).first();
    this.newConversationButton = page.locator('button:has-text("New"), button:has-text("新建")');
    this.messageInput = page.locator('[data-testid="console-composer"] textarea, textarea[placeholder]');
    this.sendButton = page.getByRole('button', { name: 'Send' });
    this.quickPrompts = page.locator('[data-testid="console-chat-panel"] button');
    this.conversationItems = page.locator('[data-testid="console-history-scroll"] > *');
    this.streamingIndicator = page.locator('.animate-pulse, [class*="streaming"]');
    this.analysisTab = page.locator('button:has-text("Analysis"), button:has-text("分析")');
    this.reportTab = page.locator('button:has-text("Report"), button:has-text("报告")');
    this.openVisualizationButton = page.locator('button:has-text("Visualization"), button:has-text("可视化")');
    this.capabilityBar = page.locator('[data-testid="console-composer"] [class*="capability"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async sendMessage(text: string): Promise<void> {
    await this.messageInput.fill(text);
    await this.sendButton.click();
  }
}
