/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://127.0.0.1:3000';

export default defineConfig({
  reporter: 'list',
  use: { 
    baseURL,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  }
});
