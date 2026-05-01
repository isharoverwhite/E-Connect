/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import path from "node:path";
import { defineConfig } from "@playwright/test";

const repoRoot = path.resolve(__dirname, "..");
const backendHealthUrl = process.env.PLAYWRIGHT_BACKEND_URL ?? "http://127.0.0.1:8000/health";
// In CI the webapp runs as a plain Next.js standalone server on HTTP port 3001
// (no TLS wrapper). Locally it runs behind the HTTPS proxy on port 3443.
const webappBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.CI ? "http://127.0.0.1:3001" : "https://localhost:3443");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: webappBaseUrl,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: path.join(repoRoot, "scripts", "run-playwright-backend.sh"),
      url: backendHealthUrl,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: path.join(repoRoot, "scripts", "run-playwright-webapp.sh"),
      url: `${webappBaseUrl}/login`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      ignoreHTTPSErrors: true,
    },
  ],
});
