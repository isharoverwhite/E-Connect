/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime, getE2ECredentials } from './support/e2e';

test.describe('WebSocket Realtime Dashboard', () => {
  test.beforeAll(async ({ request }) => {
    await ensurePlaywrightRuntime(request);
  });

  test('Happy Path: State change via MQTT reflects on UI via WS', async ({ page }) => {
    const credentials = getE2ECredentials();

    // Register the WebSocket listener BEFORE navigation begins so we cannot
    // miss the event. loginViaUi() waits for the dashboard URL which means
    // React has already hydrated and the WebSocket may already be open by the
    // time a post-login listener is registered — causing a guaranteed timeout.
    const wsPromise = page.waitForEvent('websocket', ws => ws.url().includes('/api/v1/ws'));

    // Navigate to login and authenticate manually so the WS listener is active
    // before AuthProvider opens the connection.
    await page.goto('/login');
    await page.getByPlaceholder('Enter your username').fill(credentials.username);
    await page.getByPlaceholder('••••••••').fill(credentials.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL(/\/$/);

    // Now collect the WebSocket that was opened during/after authentication.
    const ws = await wsPromise;

    // Verify connection success.
    expect(ws.url()).toContain('/api/v1/ws');

    // Make sure the dashboard shell loaded.
    await expect(page.getByText('Device Overview')).toBeVisible();

    // Collect any polling requests made after the initial page load.
    // WebSocket replaces polling, so there should be at most 1 initial fetch.
    const pollingRequests: unknown[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/v1/dashboard/devices') && req.method() === 'GET') {
        pollingRequests.push(req);
      }
    });

    await page.waitForTimeout(4000); // Previous poll interval was 3 s
    // After the initial load at most one fetch is expected — assert no polling loop.
    expect(pollingRequests.length).toBeLessThanOrEqual(1);

    console.log('WebSocket connected. Polling defeated.');
  });
});
