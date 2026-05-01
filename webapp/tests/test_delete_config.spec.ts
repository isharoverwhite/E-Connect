/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime } from './support/e2e';

test.describe('Config management', () => {
  test.beforeAll(async ({ request }) => {
    await ensurePlaywrightRuntime(request);
  });

  test('Admin can navigate to Settings > Configs without error', async ({ page, context }) => {
    // Inject auth token so AuthProvider does not redirect to /login.
    const { token } = await ensurePlaywrightRuntime(
      // Re-use an APIRequestContext bound to the baseURL.
      // The fixture exposes the token from beforeAll via the cached promise.
      // We call the already-resolved promise here — no extra network round-trip.
      page.request,
    );
    await context.addInitScript((t) => {
      window.localStorage.setItem('econnect_token', t);
    }, token);

    await page.goto('/settings');
    await page.waitForURL(/\/settings$/);

    // Navigate to the Configs tab and verify the section loads.
    await page.getByText('Configs').click();

    // The heading or the empty-state text should be visible — either means the
    // tab rendered without a crash. We do NOT assert on specific config names
    // because those depend on uncontrolled fixture state.
    await expect(
      page.locator('text=Unused').or(page.locator('text=Configuration')).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

