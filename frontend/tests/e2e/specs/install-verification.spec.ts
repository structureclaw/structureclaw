import { test, expect } from '@playwright/test';
import { SettingsPage } from '../pages/settings.page';
import { DatabasePage } from '../pages/database.page';
import { CapabilitiesPage } from '../pages/capabilities.page';

test.describe('Install verification', () => {
  test('server responds to health check', async ({ request }) => {
    const response = await request.get('/api/v1');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.name).toBe('StructureClaw API');
  });

  test('settings API returns configuration', async ({ request }) => {
    const response = await request.get('/api/v1/admin/settings');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('server');
    expect(body).toHaveProperty('llm');
    expect(body).toHaveProperty('database');
    expect(body).toHaveProperty('analysis');
  });

  test('LLM settings page loads and displays config', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    await expect(settingsPage.baseUrlInput).toBeVisible();
    await expect(settingsPage.modelInput).toBeVisible();
  });

  test('LLM settings can be updated via API', async ({ request }) => {
    const getResp = await request.get('/api/v1/admin/llm');
    const original = await getResp.json();

    const putResp = await request.put('/api/v1/admin/llm', {
      data: {
        baseUrl: original.baseUrl,
        model: original.model,
        apiKeyMode: 'keep',
      },
    });
    expect(putResp.status()).toBe(200);

    const after = await putResp.json();
    expect(after.baseUrl).toBe(original.baseUrl);
    expect(after.model).toBe(original.model);
  });

  test('database admin shows healthy SQLite', async ({ page, request }) => {
    const dbPage = new DatabasePage(page);
    await dbPage.goto();

    await expect(dbPage.statusCard).toBeVisible();
    await expect(page.getByText('sqlite', { exact: true })).toBeVisible({ timeout: 15_000 });

    const resp = await request.get('/api/v1/admin/database/status');
    const body = await resp.json();
    expect(body.provider).toBe('sqlite');
    expect(body.database.exists).toBe(true);
    expect(body.database.writable).toBe(true);
  });

  test('capabilities page loads skills', async ({ page }) => {
    const capPage = new CapabilitiesPage(page);
    await capPage.goto();

    await expect(page.getByText(/beam|frame|truss/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
