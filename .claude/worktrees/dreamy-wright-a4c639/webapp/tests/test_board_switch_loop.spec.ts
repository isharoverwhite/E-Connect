/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

// @ts-check
import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime } from './support/e2e';

const ESP8266_SAVED_DRAFT = {
  projectId: null,
  projectName: 'Cached Project Name',
  boardId: 'nodemcuv2',
  roomId: 1,
  wifiCredentialId: 1,
  flashSource: 'server',
  pins: [],
  family: 'ESP8266'
};

test.describe('DIY Flasher Infinite Loop Regression Tests', () => {
  test('Should strictly hydrate and not crash when switching boards', async ({ page, context, request }) => {
    // Resolve runtime and inject token inline — guarantees token is present
    // before the first navigation (avoids beforeAll/beforeEach race).
    const { token } = await ensurePlaywrightRuntime(request);
    await context.addInitScript((t: string) => {
      window.localStorage.setItem('econnect_token', t);
    }, token);

    const errors: string[] = [];
    page.on('pageerror', (exception) => errors.push(exception.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/v1/')) {
        console.log(`[API] url: ${response.url()}, status: ${response.status()}`);
      }
    });

    // 1. Visit Flasher page
    await page.goto('/devices/diy');

    // Verify we remain on the correct route and don't bounce to login
    await expect(page).toHaveURL(/.*\/devices\/diy$/, { timeout: 5000 });
    
    // 2. Wait for SVG builder to finish loading before interacting.
    await expect(page.getByText('Loading SVG builder...')).toBeHidden({ timeout: 15000 });

    // 3. Trigger Board Family switch flow
    await page.getByRole('heading', { name: 'ESP8266', exact: true }).click();
    await expect(page.getByText('Selected: NodeMCU (v2/v3)')).toBeVisible();

    await page.getByRole('heading', { name: 'ESP32-C3', exact: true }).click();
    await expect(page.getByText('Selected: ESP32-C3 DevKitM-1')).toBeVisible();

    // The user needs a board name, area, and Wi-Fi selection to proceed.
    await page.getByLabel(/Board Name/i).fill('Loop Regression Device');
    const nextBtn = page.getByRole('button', { name: /Next:\s*Configs/i });
    await expect(nextBtn).toBeEnabled({ timeout: 10000 });
    await nextBtn.click();
    
    // In Step 2, create a new config entry for this board profile.
    await page.getByRole('button', { name: 'Create Configuration' }).click();
    
    const continueBtn = page.getByRole('button', { name: /Next:\s*Pin Mapping/i });
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    
    // 5. Assert NO fatal update loop errors
    const fatalErrors = errors.filter(e => 
      e.includes('Maximum update depth exceeded') || 
      e.includes('ERR_INSUFFICIENT_RESOURCES')
    );
    expect(fatalErrors.length).toBe(0);
  });

  test('Should ignore cached local DIY drafts when opening a fresh new-device session', async ({ page, context, request }) => {
    // Resolve runtime and inject token inline.
    const { token } = await ensurePlaywrightRuntime(request);
    await context.addInitScript((t: string) => {
      window.localStorage.setItem('econnect_token', t);
    }, token);

    // 1. Inject the legacy draft BEFORE visiting the page. The fresh-device
    // flow should ignore it.
    await context.addInitScript((draftData: unknown) => {
      window.localStorage.setItem('econnect:diy-svg-builder:v2', JSON.stringify(draftData));
    }, ESP8266_SAVED_DRAFT);

    const errors: string[] = [];
    page.on('pageerror', (exception) => errors.push(exception.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // 2. Open Flasher natively and let it hydrate
    await page.goto('/devices/diy');
    
    await expect(page).toHaveURL(/.*\/devices\/diy$/, { timeout: 5000 });

    // Wait for the page to finish hydrating before asserting on form fields.
    await expect(page.getByText('Loading SVG builder...')).toBeHidden({ timeout: 15000 });

    // 3. The new-device path must stay fresh instead of restoring the cached draft name/board.
    await expect(page.getByLabel(/Board Name/i)).toHaveValue('');
    await expect(page.getByText('Selected: DFRobot Beetle ESP32-C3')).toBeVisible();
    await expect(page.getByText('Wi-Fi Network (Required for initial boot)')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Assigned Area (Optional)')).toBeVisible();

    // 4. No depth loops or crashes
    const fatalErrors = errors.filter(e => 
        e.includes('Maximum update depth exceeded') || 
        e.includes('ERR_INSUFFICIENT_RESOURCES')
    );
    expect(fatalErrors.length).toBe(0);
  });
});
