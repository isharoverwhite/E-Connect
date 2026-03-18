import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  use: { 
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  }
});
