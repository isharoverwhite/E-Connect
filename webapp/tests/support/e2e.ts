/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { expect, type APIRequestContext, type Page } from "@playwright/test";

type E2ECredentials = {
  username: string;
  password: string;
  fullname: string;
  householdName: string;
};

type AuthResponse = {
  access_token: string;
};

type RoomRecord = {
  room_id: number;
  name: string;
};

type WifiCredentialRecord = {
  id: number;
  ssid: string;
};

const DEFAULT_CREDENTIALS: E2ECredentials = {
  username: process.env.TEST_USERNAME ?? "playwright-admin",
  password: process.env.TEST_PASSWORD ?? "PlaywrightPass!2026",
  fullname: "Playwright Admin",
  householdName: "Playwright Household",
};

const DEFAULT_HOME_LOCATION = {
  latitude: 51.4826,
  longitude: -0.0077,
  label: "Greenwich",
  source: "manual_coordinates",
};

const DEFAULT_ROOM_NAME = "Playwright Lab";
const DEFAULT_WIFI = {
  ssid: "Playwright QA Network",
  password: "playwright-wifi-secret",
};

let runtimeReadyPromise: Promise<{ token: string; credentials: E2ECredentials }> | null = null;

async function waitForBackendReadiness(request: APIRequestContext): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request.get("/api/v1/system/status");
    if (response.ok()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for Playwright backend readiness.");
}

async function fetchSystemStatus(request: APIRequestContext): Promise<{ initialized: boolean }> {
  const response = await request.get("/api/v1/system/status");
  expect(response.ok(), "Expected system status endpoint to be reachable").toBeTruthy();
  return (await response.json()) as { initialized: boolean };
}

async function createInitialAdmin(
  request: APIRequestContext,
  credentials: E2ECredentials,
): Promise<void> {
  const response = await request.post("/api/v1/auth/initialserver", {
    data: {
      fullname: credentials.fullname,
      username: credentials.username,
      password: credentials.password,
      householdName: credentials.householdName,
      language: "en",
      home_location: DEFAULT_HOME_LOCATION,
    },
  });

  if (response.ok()) {
    return;
  }

  const payload = await response.json().catch(() => ({}));
  const isAlreadyInitialized =
    response.status() === 403 &&
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    payload.detail &&
    typeof payload.detail === "object" &&
    payload.detail.error === "system_initialized";

  if (!isAlreadyInitialized) {
    throw new Error(`Failed to initialize Playwright admin: ${JSON.stringify(payload)}`);
  }
}

async function loginAsAdmin(
  request: APIRequestContext,
  credentials: E2ECredentials,
): Promise<string> {
  const response = await request.post("/api/v1/auth/token", {
    form: {
      username: credentials.username,
      password: credentials.password,
    },
  });

  expect(response.ok(), `Failed to login as ${credentials.username}`).toBeTruthy();
  const payload = (await response.json()) as AuthResponse;
  return payload.access_token;
}

async function ensureArea(request: APIRequestContext, authToken: string): Promise<void> {
  const headers = { Authorization: `Bearer ${authToken}` };
  const roomsResponse = await request.get("/api/v1/rooms", { headers });
  expect(roomsResponse.ok(), "Expected room listing to succeed").toBeTruthy();
  const rooms = (await roomsResponse.json()) as RoomRecord[];
  if (rooms.some((room) => room.name === DEFAULT_ROOM_NAME)) {
    return;
  }

  const createResponse = await request.post("/api/v1/rooms", {
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    data: {
      name: DEFAULT_ROOM_NAME,
      allowed_user_ids: [],
    },
  });

  if (createResponse.ok() || createResponse.status() === 409) {
    return;
  }

  throw new Error(`Failed to ensure Playwright area: ${await createResponse.text()}`);
}

async function ensureWifiCredential(request: APIRequestContext, authToken: string): Promise<void> {
  const headers = { Authorization: `Bearer ${authToken}` };
  const wifiResponse = await request.get("/api/v1/wifi-credentials", { headers });
  expect(wifiResponse.ok(), "Expected Wi-Fi credential listing to succeed").toBeTruthy();
  const credentials = (await wifiResponse.json()) as WifiCredentialRecord[];
  if (credentials.some((credential) => credential.ssid === DEFAULT_WIFI.ssid)) {
    return;
  }

  const createResponse = await request.post("/api/v1/wifi-credentials", {
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    data: DEFAULT_WIFI,
  });

  if (createResponse.ok() || createResponse.status() === 409) {
    return;
  }

  throw new Error(`Failed to ensure Playwright Wi-Fi credential: ${await createResponse.text()}`);
}

export function getE2ECredentials(): E2ECredentials {
  return DEFAULT_CREDENTIALS;
}

export async function ensurePlaywrightRuntime(
  request: APIRequestContext,
): Promise<{ token: string; credentials: E2ECredentials }> {
  if (!runtimeReadyPromise) {
    runtimeReadyPromise = (async () => {
      const credentials = getE2ECredentials();
      await waitForBackendReadiness(request);
      const status = await fetchSystemStatus(request);
      if (!status.initialized) {
        await createInitialAdmin(request, credentials);
      }
      const token = await loginAsAdmin(request, credentials);
      await ensureArea(request, token);
      await ensureWifiCredential(request, token);
      return { token, credentials };
    })();
  }

  return runtimeReadyPromise;
}

export async function loginViaUi(page: Page): Promise<void> {
  const credentials = getE2ECredentials();
  await page.goto("/login");
  await page.getByPlaceholder("Enter your username").fill(credentials.username);
  await page.getByPlaceholder("••••••••").fill(credentials.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/$/);
}
