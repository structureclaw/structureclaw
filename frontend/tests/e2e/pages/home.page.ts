import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly headerLogo: Locator;
  readonly openConsoleLink: Locator;
  readonly enterConsoleButton: Locator;
  readonly languageToggle: Locator;
  readonly themeToggle: Locator;
  readonly heroTitle: Locator;
  readonly featureCards: Locator;
  readonly promptCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.headerLogo = page.locator('header >> text=StructureClaw');
    this.openConsoleLink = page.locator('header >> a[href="/console"]');
    this.enterConsoleButton = page.locator('a[href="/console"] >> role=button');
    this.languageToggle = page.locator('header [role="group"][aria-label]');
    this.themeToggle = page.locator('header button[aria-label]');
    this.heroTitle = page.locator('h1');
    this.featureCards = page.locator('#workflow article, #workflow [class*="card"]');
    this.promptCards = page.locator('main >> .rounded-3xl.border');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }
}
