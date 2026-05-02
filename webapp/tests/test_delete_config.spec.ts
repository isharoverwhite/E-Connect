/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime } from './support/e2e';

test.describe('Config management', () => {
  let authToken = '';

  test.beforeAll(async ({ request }) => {
    const runtime = await ensurePlaywrightRuntime(request);
    authToken = runtime.token;
  });

  // Inject the auth token before every test navigation so AuthProvider does
  // not redirect to /login before the page can hydrate.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript((token) => {
      window.localStorage.setItem('econnect_token', token);
    }, authToken);
  });

  test('Admin can navigate to Settings > Configs without error', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL(/\/settings$/);

    // Navigate to the Configs tab. Use a tab/button role to avoid matching
    // generic text in other parts of the page.
    await page.getByRole('button', { name: 'Configs' }).click();

    // Wait for the ConfigsPanel heading — this is always present once the tab
    // renders and the API call for configs resolves (or fails). We do NOT assert
    // on specific config names because those depend on uncontrolled fixture state.
    await expect(
      page.getByRole('heading', { name: 'Manage Saved Configs' }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
