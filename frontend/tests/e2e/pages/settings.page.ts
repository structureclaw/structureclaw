import type { Page, Locator } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly baseUrlInput: Locator;
  readonly modelInput: Locator;
  readonly saveButton: Locator;
  readonly resetButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.baseUrlInput = page.locator('#llm-base-url');
    this.modelInput = page.locator('#llm-model');
    this.saveButton = page.locator('button:has-text("Save"), button:has-text("保存")');
    this.resetButton = page.locator('button:has-text("Reset"), button:has-text("重置"), button:has-text("Reset Defaults"), button:has-text("恢复默认")');
  }

  async goto(): Promise<void> {
    await this.page.goto('/llm');
    await this.baseUrlInput.waitFor({ state: 'visible' });
  }

  async getBaseUrl(): Promise<string> {
    return this.baseUrlInput.inputValue();
  }

  async getModel(): Promise<string> {
    return this.modelInput.inputValue();
  }

  async updateSettings(baseUrl: string, model: string): Promise<void> {
    await this.baseUrlInput.fill(baseUrl);
    await this.modelInput.fill(model);
    await this.saveButton.click();
    await this.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/admin/llm') && resp.request().method() === 'PUT',
      { timeout: 10_000 },
    );
  }
}
