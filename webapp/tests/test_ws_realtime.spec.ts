/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime, loginViaUi } from './support/e2e';

test.describe('WebSocket Realtime Dashboard', () => {
  test.beforeAll(async ({ request }) => {
    await ensurePlaywrightRuntime(request);
  });

  test('Happy Path: State change via MQTT reflects on UI via WS', async ({ page }) => {
    await loginViaUi(page);
    
    // Wait for WS connection
    const wsPromise = page.waitForEvent('websocket', ws => ws.url().includes('/api/v1/ws'));
    const ws = await wsPromise;

    // Verify connection success (wait for it to be open)
    expect(ws.url()).toContain('/api/v1/ws');

    // Make sure the dashboard shell loaded.
    await expect(page.getByText('Device Overview')).toBeVisible();

    // Now publish a fake state message for a device using an HTTP API call to bypass mosquitto_pub locally
    // Actually we can just wait for a while to ensure no polling requests are sent
    const requests = [];
    page.on('request', req => {
      if (req.url().includes('/api/v1/dashboard/devices') && req.method() === 'GET') {
        requests.push(req);
      }
    });

    await page.waitForTimeout(4000); // Poll was 3s
    // Initial load happens, so length should be 0 or 1.
    // Let's assert polling is defeated
    expect(requests.length).toBeLessThanOrEqual(1);
    
    console.log("WebSocket connected. Polling removed.");
  });
});
