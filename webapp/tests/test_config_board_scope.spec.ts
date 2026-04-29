/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { ensurePlaywrightRuntime } from "./support/e2e";

type RoomRecord = {
  room_id: number;
  name: string;
};

type WifiCredentialRecord = {
  id: number;
  ssid: string;
};

type DiyProjectRecord = {
  id: string;
  name: string;
  board_profile: string;
  config: Record<string, unknown>;
};

async function createDiyProject(
  request: APIRequestContext,
  authHeaders: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<DiyProjectRecord> {
  const createRes = await request.post("/api/v1/diy/projects", {
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    data: payload,
  });
  expect(createRes.ok()).toBeTruthy();
  return (await createRes.json()) as DiyProjectRecord;
}

async function listBoardProjects(
  request: APIRequestContext,
  authHeaders: Record<string, string>,
  boardProfile: string,
): Promise<DiyProjectRecord[]> {
  const projectsRes = await request.get(`/api/v1/diy/projects?board_profile=${boardProfile}`, {
    headers: authHeaders,
  });
  expect(projectsRes.ok()).toBeTruthy();
  return (await projectsRes.json()) as DiyProjectRecord[];
}

async function deleteDiyProject(
  request: APIRequestContext,
  authHeaders: Record<string, string>,
  projectId: string,
  password: string,
): Promise<void> {
  const deleteRes = await request.delete(`/api/v1/diy/projects/${projectId}`, {
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    data: { password },
  });
  expect(deleteRes.ok()).toBeTruthy();
}

test.describe("DIY config board scoping", () => {
  let authToken = "";
  let accountPassword = "";

  test.beforeAll(async ({ request }) => {
    const runtime = await ensurePlaywrightRuntime(request);
    accountPassword = runtime.credentials.password;
    authToken = runtime.token;
  });

  test("new-device flow loads the selected saved config without creating an unexpected clone", async ({
    context,
    page,
    request,
  }) => {
    test.skip(!authToken, "Auth token unavailable");

    const authHeaders = {
      Authorization: `Bearer ${authToken}`,
    };

    const roomRes = await request.get("/api/v1/rooms", { headers: authHeaders });
    expect(roomRes.ok()).toBeTruthy();
    const rooms = (await roomRes.json()) as RoomRecord[];
    test.skip(rooms.length === 0, "Requires at least one area");

    const wifiRes = await request.get("/api/v1/wifi-credentials", { headers: authHeaders });
    expect(wifiRes.ok()).toBeTruthy();
    const wifiCredentials = (await wifiRes.json()) as WifiCredentialRecord[];
    test.skip(wifiCredentials.length === 0, "Requires at least one Wi-Fi credential");

    const roomId = rooms[0].room_id;
    const wifiCredentialId = wifiCredentials[0].id;
    const projectName = `Board Scope Regression ${Date.now()}`;
    const freshBoardName = `Fresh Device ${Date.now()}`;

    const createPayload = {
      name: projectName,
      board_profile: "esp32-devkit-v1",
      room_id: roomId,
      wifi_credential_id: wifiCredentialId,
      config: {
        schema_version: 1,
        project_name: projectName,
        room_id: roomId,
        family: "ESP32",
        board_id: "esp32-devkit-v1",
        board_profile: "esp32-devkit-v1",
        board_type: "ESP32",
        flash_source: "server",
        serial_port: "browser-web-serial",
        wifi_credential_id: wifiCredentialId,
        pins: [],
      },
    };

    const project = await createDiyProject(request, authHeaders, createPayload);

    try {
      await context.addInitScript((token) => {
        window.localStorage.setItem("econnect_token", token);
      }, authToken);

      await page.goto("/devices/diy");
      await expect(page).toHaveURL(/\/devices\/diy$/);
      await expect(page.getByLabel(/Board Name/i)).toHaveValue("");
      await expect(page.getByRole("button", { name: /Next:\s*Configs/i })).toBeDisabled();

      await page.getByLabel(/Board Name/i).fill(freshBoardName);
      await page.getByRole("heading", { name: "ESP32", exact: true }).click();
      await page.getByRole("button", { name: /ESP32 DevKit V1/i }).click();

      const nextButton = page.getByRole("button", { name: /Next:\s*Configs/i });
      await expect(nextButton).toBeEnabled({ timeout: 10000 });
      await nextButton.click();

      await expect(page.getByRole("button", { name: /Create.*Config/i })).toBeVisible({
        timeout: 10000,
      });
      await page.getByRole("button", { name: projectName }).click();

      await expect(
        page.getByText(`Loaded saved config ${projectName}.`),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole("button", { name: "Save as New Config" })).toBeVisible();
      const continueButton = page.getByRole("button", { name: /Next:\s*Pin Mapping/i });
      await expect(continueButton).toBeEnabled();

      await continueButton.click();
      await expect(page.getByRole("button", { name: "Validate Wiring" })).toBeVisible({
        timeout: 10000,
      });

      const projectAfterRes = await request.get(`/api/v1/diy/projects/${project.id}`, {
        headers: authHeaders,
      });
      expect(projectAfterRes.ok()).toBeTruthy();
      const projectAfter = (await projectAfterRes.json()) as DiyProjectRecord;
      expect(projectAfter.name).toBe(projectName);
      expect(projectAfter.board_profile).toBe("esp32-devkit-v1");
      expect(projectAfter.config.board_id).toBe("esp32-devkit-v1");
      expect(projectAfter.config.board_profile).toBe("esp32-devkit-v1");

      const projects = await listBoardProjects(request, authHeaders, "esp32-devkit-v1");
      expect(
        projects.some((entry) => entry.id === project.id && entry.name === projectName),
      ).toBeTruthy();
      expect(projects.filter((entry) => entry.name === projectName)).toHaveLength(1);
      expect(projects.some((entry) => entry.name === freshBoardName)).toBeFalsy();
    } finally {
      await deleteDiyProject(request, authHeaders, project.id, accountPassword);
    }
  });

  test("manually created config can switch to another saved config without creating an implicit third project", async ({
    context,
    page,
    request,
  }) => {
    test.skip(!authToken, "Auth token unavailable");

    const authHeaders = {
      Authorization: `Bearer ${authToken}`,
    };

    const roomRes = await request.get("/api/v1/rooms", { headers: authHeaders });
    expect(roomRes.ok()).toBeTruthy();
    const rooms = (await roomRes.json()) as RoomRecord[];
    test.skip(rooms.length === 0, "Requires at least one area");

    const wifiRes = await request.get("/api/v1/wifi-credentials", { headers: authHeaders });
    expect(wifiRes.ok()).toBeTruthy();
    const wifiCredentials = (await wifiRes.json()) as WifiCredentialRecord[];
    test.skip(wifiCredentials.length === 0, "Requires at least one Wi-Fi credential");

    const roomId = rooms[0].room_id;
    const wifiCredentialId = wifiCredentials[0].id;
    const templateProjectName = `Switch Library ${Date.now()}`;
    const manualProjectName = `Manual Create ${Date.now()}`;

    const templateProject = await createDiyProject(request, authHeaders, {
      name: templateProjectName,
      board_profile: "esp32-devkit-v1",
      room_id: roomId,
      wifi_credential_id: wifiCredentialId,
      config: {
        schema_version: 1,
        project_name: templateProjectName,
        room_id: roomId,
        family: "ESP32",
        board_id: "esp32-devkit-v1",
        board_profile: "esp32-devkit-v1",
        board_type: "ESP32",
        flash_source: "server",
        serial_port: "browser-web-serial",
        wifi_credential_id: wifiCredentialId,
        pins: [],
      },
    });

    try {
      await context.addInitScript((token) => {
        window.localStorage.setItem("econnect_token", token);
      }, authToken);

      await page.goto("/devices/diy");
      await expect(page).toHaveURL(/\/devices\/diy$/);

      await page.getByLabel(/Board Name/i).fill(manualProjectName);
      await page.getByRole("heading", { name: "ESP32", exact: true }).click();
      await page.getByRole("button", { name: /ESP32 DevKit V1/i }).click();
      await page.getByRole("button", { name: /Next:\s*Configs/i }).click();

      await page.getByRole("button", { name: /Create.*Config/i }).click();
      await expect(page.getByText(`Server draft saved as ${manualProjectName}.`)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByRole("button", { name: /Next:\s*Pin Mapping/i })).toBeEnabled();

      await page.getByRole("button", { name: templateProjectName }).click();
      await expect(
        page.getByText(`Loaded saved config ${templateProjectName}.`),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole("button", { name: "Save as New Config" })).toBeVisible();

      const continueButton = page.getByRole("button", { name: /Next:\s*Pin Mapping/i });
      await expect(continueButton).toBeEnabled();
      await continueButton.click();

      await expect(page.getByRole("button", { name: "Validate Wiring" })).toBeVisible({
        timeout: 10000,
      });

      const projects = await listBoardProjects(request, authHeaders, "esp32-devkit-v1");
      expect(projects.filter((entry) => entry.name === manualProjectName)).toHaveLength(1);
      expect(
        projects.some(
          (entry) => entry.id === templateProject.id && entry.name === templateProjectName,
        ),
      ).toBeTruthy();
      expect(projects.filter((entry) => entry.name === templateProjectName)).toHaveLength(1);
    } finally {
      const cleanupProjects = await listBoardProjects(request, authHeaders, "esp32-devkit-v1");
      for (const targetName of [templateProjectName, manualProjectName]) {
        const matchedProject = cleanupProjects.find((entry) => entry.name === targetName);
        if (matchedProject) {
          await deleteDiyProject(request, authHeaders, matchedProject.id, accountPassword);
        }
      }
    }
  });
});
