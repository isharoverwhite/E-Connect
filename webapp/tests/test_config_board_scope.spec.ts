import { test, expect } from "@playwright/test";

const DRAFT_STORAGE_KEY = "econnect:diy-svg-builder:v2";

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

  test("changing Step 1 board detaches the saved config instead of rewriting it", async ({
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

      await context.addInitScript(
        ({ projectId, projectName: savedProjectName, roomId: savedRoomId, wifiCredentialId: savedWifiId }) => {
          window.localStorage.setItem(
            DRAFT_STORAGE_KEY,
            JSON.stringify({
              projectId,
              projectName: savedProjectName,
              roomId: savedRoomId,
              wifiCredentialId: savedWifiId,
              family: "ESP32",
              boardId: "esp32-devkit-v1",
              pins: [],
              flashSource: "server",
              serialPort: "browser-web-serial",
            }),
          );
        },
        {
          projectId: project.id,
          projectName,
          roomId,
          wifiCredentialId,
        },
      );

      await page.goto("/devices/diy");
      await expect(page).toHaveURL(/\/devices\/diy$/);
      await expect(page.getByText(`Loaded saved config ${projectName}.`)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText("Selected: ESP32 DevKit V1")).toBeVisible();

      await page.getByRole("heading", { name: "ESP32-C3", exact: true }).click();

      await expect(
        page.getByText(
          "The original config stays attached to its saved board profile. Choose a saved config or create a new one for this board before continuing.",
        ),
      ).toBeVisible({ timeout: 10000 });

      await page.getByRole("button", { name: /Next: Choose Config/ }).click();
      await expect(page.getByRole("button", { name: "Create Config" })).toBeVisible({
        timeout: 10000,
      });

      const projectAfterRes = await request.get(`/api/v1/diy/projects/${project.id}`, {
        headers: authHeaders,
      });
      expect(projectAfterRes.ok()).toBeTruthy();
      const projectAfter = (await projectAfterRes.json()) as DiyProjectRecord;
      expect(projectAfter.board_profile).toBe("esp32-devkit-v1");
      expect(projectAfter.config.board_id).toBe("esp32-devkit-v1");
      expect(projectAfter.config.board_profile).toBe("esp32-devkit-v1");
    } finally {
      await request.delete(`/api/v1/diy/projects/${project.id}`, {
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        data: { password: accountPassword },
      });
    }
  });
});
