import type { Page, Locator } from '@playwright/test';

export class DatabasePage {
  readonly page: Page;
  readonly statusCard: Locator;
  readonly providerLabel: Locator;
  readonly modeLabel: Locator;
  readonly filePath: Locator;
  readonly troubleshootCard: Locator;

  constructor(page: Page) {
    this.page = page;
    this.statusCard = page.locator('article, [class*="card"]').first();
    this.providerLabel = page.locator('text=Provider, text=提供者').first();
    this.modeLabel = page.locator('text=Mode, text=模式').first();
    this.filePath = page.locator('text=File, text=文件').first();
    this.troubleshootCard = page.locator('text=Troubleshoot, text=故障').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/database');
    await this.page.waitForLoadState('networkidle');
  }
}
