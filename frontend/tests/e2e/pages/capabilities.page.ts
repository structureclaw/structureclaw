import type { Page, Locator } from '@playwright/test';

export class CapabilitiesPage {
  readonly page: Page;
  readonly skillGroups: Locator;
  readonly toolGroups: Locator;
  readonly resetSkillsButton: Locator;
  readonly resetToolsButton: Locator;
  readonly toggles: Locator;

  constructor(page: Page) {
    this.page = page;
    this.skillGroups = page.locator('[class*="skill"], [data-testid*="skill"]');
    this.toolGroups = page.locator('[class*="tool"], [data-testid*="tool"]');
    this.resetSkillsButton = page.locator('button:has-text("Reset"), button:has-text("重置")').first();
    this.resetToolsButton = page.locator('button:has-text("Reset"), button:has-text("重置")').last();
    this.toggles = page.locator('button[role="switch"], input[type="checkbox"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/console/capabilities');
    await this.page.waitForLoadState('networkidle');
  }
}
