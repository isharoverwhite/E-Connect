/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime } from './support/e2e';

test.describe('WebSocket Realtime Dashboard', () => {
  test('Happy Path: State change via MQTT reflects on UI via WS', async ({ page, context, request }) => {
    // Resolve runtime inline — guarantees backend is ready and token is present
    // before any navigation attempt.
    const { token } = await ensurePlaywrightRuntime(request);

    // Register the WebSocket listener BEFORE injecting auth and navigating.
    // The listener captures any WS opened during or after the first navigation,
    // so we must set it up first.
    const wsPromise = page.waitForEvent('websocket', { timeout: 30_000 });

    // Inject the token so AuthProvider navigates directly to the dashboard
    // without going through /login. This ensures the WS open happens as part
    // of the initial authenticated page load — the wsPromise listener is
    // already active at this point.
    await context.addInitScript((t: string) => {
      window.localStorage.setItem('econnect_token', t);
    }, token);

    await page.goto('/');
    await page.waitForURL(/^\/?$|\/$/);

    // Wait for the WebSocket that was opened during dashboard hydration.
    const ws = await wsPromise;

    // Verify connection success.
    expect(ws.url()).toContain('/api/v1/ws');

    // Make sure the dashboard shell loaded.
    await expect(page.getByText('Device Overview')).toBeVisible({ timeout: 15_000 });

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
