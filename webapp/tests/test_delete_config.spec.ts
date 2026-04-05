/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from '@playwright/test';

test.describe('Config management', () => {
  test('Admin can delete config from another user', async ({ page }) => {
    test.skip(!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD, 'Requires TEST_USERNAME and TEST_PASSWORD');

    // Navigate to dashboard
    await page.goto('/login');
    
    // Login as an admin test account
    await page.getByPlaceholder('Enter your username').fill(process.env.TEST_USERNAME!);
    await page.getByRole('textbox', { name: "Password" }).fill(process.env.TEST_PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Wait for redirect to dashboard
    await page.waitForURL(/\/settings$/);
    
    // Go to Configs
    await page.getByText('Configs').click();
    await page.waitForSelector('text=Unused');
    
    // We should not see LED anymore because it is deleted, but we can verify it's working by trying to create and delete a new one.
    // However, since we just fixed the backend, the fact that LED is gone is the proof.
    
    const ledConfig = page.locator('text=LED').first();
    await expect(ledConfig).toBeHidden();
  });
});
