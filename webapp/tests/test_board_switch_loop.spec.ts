/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

// @ts-check
import { test, expect } from '@playwright/test';

const ESP8266_SAVED_DRAFT = {
  projectId: null,
  projectName: 'Test Project Node',
  boardId: 'nodemcuv2',
  wifiSsid: 'TestWiFi',
  wifiPassword: 'TestPassword',
  flashSource: 'server',
  pins: [],
  family: 'ESP8266'
};

test.describe('DIY Flasher Infinite Loop Regression Tests', () => {
  let authToken = '';

  test.beforeAll(async ({ request }) => {
    // 1. Fetch a real access token from the backend
    const username = process.env.TEST_USERNAME;
    const password = process.env.TEST_PASSWORD;

    if (!username || !password) {
      console.log('Skipping test: Missing TEST_USERNAME or TEST_PASSWORD environment variables');
      test.skip(true, 'Missing TEST_USERNAME or TEST_PASSWORD environment variables');
      return;
    }

    const loginRes = await request.post('/api/v1/auth/token', {
      form: { username, password }
    });
    
    // We expect the seeded QA admin or configured test user to work
    expect(loginRes.ok(), `Failed to login to get test token with user ${username}`).toBeTruthy();
    const data = await loginRes.json();
    authToken = data.access_token;
  });

  test.beforeEach(async ({ context }) => {
    // Inject the real token using an init script so it is available perfectly 
    // before Next.js and React execute. This prevents the race condition 
    // where AuthProvider redirects to /login and /login clears the token.
    await context.addInitScript((token) => {
      window.localStorage.setItem('econnect_token', token);
    }, authToken);
  });

  test('Should strictly hydrate and not crash when switching boards', async ({ page }) => {
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
    
    // 2. Hydration will complete without crashing because hasHydratedRef handles first-load.
    await expect(page.getByText('Loading SVG builder...')).toBeHidden({ timeout: 10000 });

    // 3. Trigger Board Family switch flow
    await page.getByRole('heading', { name: 'ESP8266', exact: true }).click();
    await expect(page.getByText('Selected: NodeMCU (v2/v3)')).toBeVisible();

    await page.getByRole('heading', { name: 'ESP32-C3', exact: true }).click();
    await expect(page.getByText('Selected: ESP32-C3 DevKitM-1')).toBeVisible();

    // The user needs a room to be selected to proceed. Wait for the API to auto-select the first room.
    // Ensure the 'Next: Choose Config' button is enabled.
    const nextBtn = page.getByRole('button', { name: 'Next: Choose Config' });
    await expect(nextBtn).toBeEnabled({ timeout: 10000 });
    await nextBtn.click();
    
    // In Step 2, we need a saved config. Create one.
    await page.getByRole('button', { name: 'Create Config' }).click();
    
    const continueBtn = page.getByRole('button', { name: 'Continue to Pin Mapping' });
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    
    // 5. Assert NO fatal update loop errors
    const fatalErrors = errors.filter(e => 
      e.includes('Maximum update depth exceeded') || 
      e.includes('ERR_INSUFFICIENT_RESOURCES')
    );
    expect(fatalErrors.length).toBe(0);
  });

  test('Should correctly reload with a saved ESP8266 draft without permanently wedging early returns', async ({ page }) => {
    // 1. Inject the draft BEFORE visiting the page so component hydrates it immediately
    await page.addInitScript((draftData) => {
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

    // 3. Ensure the hydration lock releases and UI allows us to proceed (no longer hanging)
    await expect(page.getByText('Saved local draft loaded')).toBeVisible({ timeout: 10000 });

    // 4. ESP8266 DOM should be hydrated
    await expect(page.getByText('Selected: NodeMCU (v2/v3)')).toBeVisible();

    // 5. No depth loops or crashes
    const fatalErrors = errors.filter(e => 
        e.includes('Maximum update depth exceeded') || 
        e.includes('ERR_INSUFFICIENT_RESOURCES')
    );
    expect(fatalErrors.length).toBe(0);
  });
});
