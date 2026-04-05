/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { expect, test } from "@playwright/test";

import { getBoardProfile } from "../src/features/diy/board-profiles";
import { buildFlashManifest } from "../src/features/diy/flash-manifest";

test("jc3827 server manifest uses the repo-approved full bundle offsets", () => {
  const board = getBoardProfile("jc3827w543");
  const manifest = buildFlashManifest({
    board,
    projectName: "Control Panel",
    flashSource: "server",
    serverArtifactUrls: {
      firmware: "blob:firmware",
      bootloader: "blob:bootloader",
      partitions: "blob:partitions",
      bootApp0: "blob:boot-app0",
    },
  });

  expect(manifest).not.toBeNull();
  expect(manifest?.builds[0]?.chipFamily).toBe("ESP32-S3");
  expect(manifest?.builds[0]?.parts).toEqual([
    { path: "blob:bootloader", offset: 0x1000 },
    { path: "blob:partitions", offset: 0x8000 },
    { path: "blob:boot-app0", offset: 0xE000 },
    { path: "blob:firmware", offset: 0x10000 },
  ]);
});

test("server manifest keeps single-binary ESP8266 flashes at offset zero", () => {
  const board = getBoardProfile("nodemcuv2");
  const manifest = buildFlashManifest({
    board,
    projectName: "NodeMCU",
    flashSource: "server",
    serverArtifactUrls: {
      firmware: "blob:firmware",
      bootloader: null,
      partitions: null,
      bootApp0: null,
    },
  });

  expect(manifest).not.toBeNull();
  expect(manifest?.builds[0]?.chipFamily).toBe("ESP8266");
  expect(manifest?.builds[0]?.parts).toEqual([
    { path: "blob:firmware", offset: 0x0 },
  ]);
});

test("non-JC ESP32 server manifest uses the full bundle offsets", () => {
  const board = getBoardProfile("esp32-c3-devkitm-1");
  const manifest = buildFlashManifest({
    board,
    projectName: "ESP32-C3",
    flashSource: "server",
    serverArtifactUrls: {
      firmware: "blob:firmware",
      bootloader: "blob:bootloader",
      partitions: "blob:partitions",
      bootApp0: "blob:boot-app0",
    },
  });

  expect(manifest).not.toBeNull();
  expect(manifest?.builds[0]?.chipFamily).toBe("ESP32-C3");
  expect(manifest?.builds[0]?.parts).toEqual([
    { path: "blob:bootloader", offset: 0x0 },
    { path: "blob:partitions", offset: 0x8000 },
    { path: "blob:boot-app0", offset: 0xE000 },
    { path: "blob:firmware", offset: 0x10000 },
  ]);
});

test("classic ESP32 server manifest uses the standard bootloader offset", () => {
  const board = getBoardProfile("esp32-devkit-v1");
  const manifest = buildFlashManifest({
    board,
    projectName: "ESP32",
    flashSource: "server",
    serverArtifactUrls: {
      firmware: "blob:firmware",
      bootloader: "blob:bootloader",
      partitions: "blob:partitions",
      bootApp0: "blob:boot-app0",
    },
  });

  expect(manifest).not.toBeNull();
  expect(manifest?.builds[0]?.chipFamily).toBe("ESP32");
  expect(manifest?.builds[0]?.parts).toEqual([
    { path: "blob:bootloader", offset: 0x1000 },
    { path: "blob:partitions", offset: 0x8000 },
    { path: "blob:boot-app0", offset: 0xE000 },
    { path: "blob:firmware", offset: 0x10000 },
  ]);
});
