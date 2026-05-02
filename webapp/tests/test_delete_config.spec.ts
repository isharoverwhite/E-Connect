/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';
import { ensurePlaywrightRuntime } from './support/e2e';

test.describe('Config management', () => {
  test('Admin can navigate to Settings > Configs without error', async ({ page, context, request }) => {
    // Resolve the runtime (starts backend if needed) and get the auth token.
    // Calling this inline — not in beforeAll — guarantees the token is
    // resolved before addInitScript is registered.
    const { token } = await ensurePlaywrightRuntime(request);

    // Inject the token before the first navigation so AuthProvider never
    // redirects to /login on the initial page load.
    await context.addInitScript((t: string) => {
      window.localStorage.setItem('econnect_token', t);
    }, token);

    await page.goto('/settings');
    await page.waitForURL(/\/settings$/);

    // Navigate to the Configs tab. Use a tab/button role to avoid matching
    // generic text in other parts of the page.
    await page.getByRole('button', { name: 'Configs' }).click();

    // Wait for the ConfigsPanel heading — always present once the tab renders
    // and the API call for configs resolves (or fails gracefully).
    await expect(
      page.getByRole('heading', { name: 'Manage Saved Configs' }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
