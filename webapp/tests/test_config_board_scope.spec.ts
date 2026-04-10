/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { test, expect } from "@playwright/test";

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

test.describe("DIY config board scoping", () => {
  let authToken = "";
  let accountPassword = "";

  test.beforeAll(async ({ request }) => {
    const username = process.env.TEST_USERNAME;
    const password = process.env.TEST_PASSWORD;

    if (!username || !password) {
      test.skip(true, "Missing TEST_USERNAME or TEST_PASSWORD environment variables");
      return;
    }

    accountPassword = password;
    const loginRes = await request.post("/api/v1/auth/token", {
      form: { username, password },
    });

    expect(loginRes.ok(), `Failed to login with ${username}`).toBeTruthy();
    const data = (await loginRes.json()) as { access_token: string };
    authToken = data.access_token;
  });

  test("new-device flow treats saved configs as explicit templates instead of auto-resuming them", async ({
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
    test.skip(rooms.length === 0, "Requires at least one room");

    const wifiRes = await request.get("/api/v1/wifi-credentials", { headers: authHeaders });
    expect(wifiRes.ok()).toBeTruthy();
    const wifiCredentials = (await wifiRes.json()) as WifiCredentialRecord[];
    test.skip(wifiCredentials.length === 0, "Requires at least one Wi-Fi credential");

    const roomId = rooms[0].room_id;
    const wifiCredentialId = wifiCredentials[0].id;
    const projectName = `Board Scope Regression ${Date.now()}`;
    const newProjectName = `Fresh Device ${Date.now()}`;

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

    const createRes = await request.post("/api/v1/diy/projects", {
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      data: createPayload,
    });
    expect(createRes.ok()).toBeTruthy();
    const project = (await createRes.json()) as DiyProjectRecord;

    try {
      await context.addInitScript((token) => {
        window.localStorage.setItem("econnect_token", token);
      }, authToken);

      await page.goto("/devices/diy");
      await expect(page).toHaveURL(/\/devices\/diy$/);
      await expect(page.getByLabel("Project Name")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Next: Choose Config" })).toBeDisabled();

      await page.getByLabel("Project Name").fill(newProjectName);
      await page.getByRole("heading", { name: "ESP32", exact: true }).click();
      await page.getByRole("button", { name: /ESP32 DevKit V1/i }).click();

      const nextButton = page.getByRole("button", { name: "Next: Choose Config" });
      await expect(nextButton).toBeEnabled({ timeout: 10000 });
      await nextButton.click();

      await expect(page.getByRole("button", { name: "Create Config" })).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: projectName }).click();

      await expect(
        page.getByText(
          `Loaded ${projectName} as a template. Keep or edit your current project name, then save this as a new config before continuing.`,
        ),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel("Config Name")).toHaveValue(newProjectName);
      await expect(page.getByText("Template")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create Config" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue to Pin Mapping" })).toBeDisabled();

      await page.getByRole("button", { name: "Create Config" }).click();
      await expect(page.getByText(`Server draft saved as ${newProjectName}.`)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByRole("button", { name: "Continue to Pin Mapping" })).toBeEnabled();

      const projectAfterRes = await request.get(`/api/v1/diy/projects/${project.id}`, {
        headers: authHeaders,
      });
      expect(projectAfterRes.ok()).toBeTruthy();
      const projectAfter = (await projectAfterRes.json()) as DiyProjectRecord;
      expect(projectAfter.name).toBe(projectName);
      expect(projectAfter.board_profile).toBe("esp32-devkit-v1");
      expect(projectAfter.config.board_id).toBe("esp32-devkit-v1");
      expect(projectAfter.config.board_profile).toBe("esp32-devkit-v1");

      const projectsRes = await request.get("/api/v1/diy/projects?board_profile=esp32-devkit-v1", {
        headers: authHeaders,
      });
      expect(projectsRes.ok()).toBeTruthy();
      const projects = (await projectsRes.json()) as DiyProjectRecord[];
      expect(projects.some((entry) => entry.id === project.id && entry.name === projectName)).toBeTruthy();
      expect(projects.some((entry) => entry.name === newProjectName)).toBeTruthy();
    } finally {
      await request.delete(`/api/v1/diy/projects/${project.id}`, {
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        data: { password: accountPassword },
      });

      const cleanupProjectsRes = await request.get("/api/v1/diy/projects?board_profile=esp32-devkit-v1", {
        headers: authHeaders,
      });
      if (cleanupProjectsRes.ok()) {
        const cleanupProjects = (await cleanupProjectsRes.json()) as DiyProjectRecord[];
        const clonedProject = cleanupProjects.find((entry) => entry.name === newProjectName);
        if (clonedProject) {
          await request.delete(`/api/v1/diy/projects/${clonedProject.id}`, {
            headers: {
              ...authHeaders,
              "Content-Type": "application/json",
            },
            data: { password: accountPassword },
          });
        }
      }
    }
  });
});
