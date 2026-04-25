/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { expect, test } from "@playwright/test";

import { getBoardPinMarkers, getBoardProfile, isBoardPinReserved, type BoardPin } from "../src/features/diy/board-profiles";
import { validatePinMappings } from "../src/features/diy/validation";

const EXPLICIT_BACKEND_BOARD_IDS = [
  "esp32-devkit-v1",
  "esp32-wrover-devkit",
  "esp32-cam",
  "esp32-s2-saola-1",
  "esp32-s3-devkitc-1",
  "esp32-s3-zero",
  "esp32-c2-reference",
  "esp32-c3-devkitm-1",
  "esp32-c3-super-mini",
  "dfrobot-beetle-esp32-c3",
  "esp32-c6-devkitc-1",
  "nodemcuv2",
  "d1_mini",
  "d1_mini_pro",
  "esp01_1m",
  "esp12e",
] as const;

type BackendBoardSnapshot = {
  canonical_id: string;
  pins: Record<string, { reserved: boolean }>;
};

async function loadBackendBoardSnapshots(boardIds: string[]): Promise<Record<string, BackendBoardSnapshot>> {
  const { execFileSync } = await import("node:child_process");
  const repoRoot = `${process.cwd()}/..`;
  const script = `
import json
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])
sys.path.insert(0, str(repo_root / "server"))

from app.services.diy_validation import resolve_board_definition

board_ids = json.loads(sys.stdin.read())
snapshots = {}

for board_id in board_ids:
    try:
        board = resolve_board_definition(board_id)
    except Exception:
        continue

    snapshots[board_id] = {
        "canonical_id": board.canonical_id,
        "pins": {
            str(gpio): {"reserved": rule.reserved}
            for gpio, rule in board.pins.items()
        },
    }

print(json.dumps(snapshots))
`.trim();

  const rawOutput = execFileSync("python3", ["-c", script, repoRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    input: JSON.stringify(boardIds),
  });

  return JSON.parse(rawOutput) as Record<string, BackendBoardSnapshot>;
}

function positiveBoardPins(boardId: string): Map<number, BoardPin> {
  const board = getBoardProfile(boardId);
  if (!board) {
    throw new Error(`Missing frontend board profile ${boardId}`);
  }

  return new Map(
    [...board.leftPins, ...board.rightPins]
      .filter((pin) => pin.gpio >= 0)
      .map((pin) => [pin.gpio, pin]),
  );
}

test("frontend validation follows the board-specific C3 reserved-pin model before queueing a build", () => {
  const beetleBoard = getBoardProfile("dfrobot-beetle-esp32-c3");
  expect(beetleBoard).toBeTruthy();

  const beetleResult = validatePinMappings(
    beetleBoard!,
    [
      {
        gpio_pin: 10,
        mode: "OUTPUT",
        label: "Onboard LED",
      },
    ],
    {
      requireWifiCredentials: true,
      hasWifiCredential: true,
    },
  );

  expect(beetleResult.errors).toEqual([]);

  const devkitBoard = getBoardProfile("esp32-c3-devkitm-1");
  expect(devkitBoard).toBeTruthy();

  const devkitResult = validatePinMappings(
    devkitBoard!,
    [
      {
        gpio_pin: 20,
        mode: "OUTPUT",
        label: "UART RX pin",
      },
    ],
    {
      requireWifiCredentials: true,
      hasWifiCredential: true,
    },
  );

  expect(devkitResult.errors.some((message) => message.includes("GPIO 20") && message.includes("reserved"))).toBeTruthy();

  const superMiniBoard = getBoardProfile("esp32-c3-super-mini");
  expect(superMiniBoard).toBeTruthy();

  const superMiniResult = validatePinMappings(
    superMiniBoard!,
    [
      {
        gpio_pin: 20,
        mode: "OUTPUT",
        label: "Secondary UART RX reused as GPIO",
      },
    ],
    {
      requireWifiCredentials: true,
      hasWifiCredential: true,
    },
  );

  expect(superMiniResult.errors).toEqual([]);
});

test("boot-sensitive pins warn instead of blocking valid mappings", () => {
  const cases = [
    { boardId: "esp32-devkit-v1", gpio: 0, mode: "OUTPUT" as const },
    { boardId: "esp32-c3-devkitm-1", gpio: 9, mode: "OUTPUT" as const },
    { boardId: "dfrobot-beetle-esp32-c3", gpio: 9, mode: "OUTPUT" as const },
    { boardId: "esp32-c2-reference", gpio: 8, mode: "OUTPUT" as const },
    { boardId: "esp32-c6-devkitc-1", gpio: 8, mode: "OUTPUT" as const },
    { boardId: "esp32-cam", gpio: 0, mode: "OUTPUT" as const },
    { boardId: "d1_mini", gpio: 2, mode: "OUTPUT" as const },
  ];

  for (const testCase of cases) {
    const board = getBoardProfile(testCase.boardId);
    expect(board, `Missing board ${testCase.boardId}`).toBeTruthy();

    const result = validatePinMappings(
      board!,
      [
        {
          gpio_pin: testCase.gpio,
          mode: testCase.mode,
          label: `GPIO ${testCase.gpio}`,
        },
      ],
      {
        requireWifiCredentials: true,
        hasWifiCredential: true,
      },
    );

    expect(result.errors, `${testCase.boardId} GPIO ${testCase.gpio} should not hard-fail`).toEqual([]);
    expect(
      result.warnings.some((message) => message.includes(`GPIO ${testCase.gpio}`) && message.includes("Disconnect")),
      `${testCase.boardId} GPIO ${testCase.gpio} should warn before flashing`,
    ).toBeTruthy();
  }
});

test("board-specific LED markers stay explicit instead of relying on note heuristics", () => {
  const beetleBoard = getBoardProfile("dfrobot-beetle-esp32-c3");
  const saolaBoard = getBoardProfile("esp32-s2-saola-1");
  const esp32CamBoard = getBoardProfile("esp32-cam");
  const genericEsp32Board = getBoardProfile("esp32-devkit-v1");

  expect(beetleBoard).toBeTruthy();
  expect(saolaBoard).toBeTruthy();
  expect(esp32CamBoard).toBeTruthy();
  expect(genericEsp32Board).toBeTruthy();

  expect(getBoardPinMarkers(beetleBoard!, 10)).toEqual([{ gpio: 10, label: "LED", tone: "amber" }]);
  expect(getBoardPinMarkers(saolaBoard!, 18)).toEqual([{ gpio: 18, label: "RGB", tone: "sky" }]);
  expect(getBoardPinMarkers(esp32CamBoard!, 4)).toEqual([{ gpio: 4, label: "FLASH", tone: "amber" }]);
  expect(getBoardPinMarkers(genericEsp32Board!, 2)).toEqual([]);
});

test("frontend SVG board profiles mark every backend-reserved shared pin as reserved", async () => {
  const backendBoards = await loadBackendBoardSnapshots([...EXPLICIT_BACKEND_BOARD_IDS]);
  const mismatches: Array<{
    boardId: string;
    canonicalId: string;
    gpio: number;
  }> = [];

  for (const boardId of EXPLICIT_BACKEND_BOARD_IDS) {
    const board = getBoardProfile(boardId);
    expect(board, `Missing board ${boardId}`).toBeTruthy();
    if (!board) {
      continue;
    }

    const backendBoard = backendBoards[board.id];
    if (!backendBoard) {
      continue;
    }

    const frontendPins = positiveBoardPins(board.id);
    for (const [gpioText, backendPin] of Object.entries(backendBoard.pins)) {
      if (!backendPin.reserved) {
        continue;
      }

      const gpio = Number(gpioText);
      const frontendPin = frontendPins.get(gpio);
      if (!frontendPin) {
        continue;
      }

      if (!isBoardPinReserved(frontendPin)) {
        mismatches.push({
          boardId: board.id,
          canonicalId: backendBoard.canonical_id,
          gpio,
        });
      }
    }
  }

  expect(mismatches).toEqual([]);
});
