import type { BoardProfile } from "./board-profiles";
import type { FlashManifest, FlashSource } from "./types";

// This repo's Arduino/PlatformIO ESP32 full-bundle path follows the same
// offsets used by the PlatformIO upload command for these boards.
const ESP32_BOOTLOADER_OFFSET = 0x0;
const ESP32_PARTITIONS_OFFSET = 0x8000;
const ESP32_BOOT_APP0_OFFSET = 0xE000;
const ESP32_APPLICATION_OFFSET = 0x10000;

interface ServerArtifactUrls {
  firmware: string | null;
  bootloader: string | null;
  partitions: string | null;
  bootApp0: string | null;
}

function getSingleBinaryOffset(board: BoardProfile) {
  return board.family === "ESP8266" ? 0 : ESP32_APPLICATION_OFFSET;
}

function normalizeChipFamily(board: BoardProfile) {
  return board.family === "JC3827W543" ? "ESP32-S3" : board.family;
}

export function buildFlashManifest({
  board,
  projectName,
  flashSource,
  serverArtifactUrls,
}: {
  board: BoardProfile;
  projectName: string;
  flashSource: FlashSource;
  serverArtifactUrls: ServerArtifactUrls | null;
}): FlashManifest | null {
  const requiresFullBundle = board.id === "jc3827w543";

  if (flashSource === "server") {
    if (!serverArtifactUrls?.firmware) {
      return null;
    }

    if (
      requiresFullBundle &&
      (!serverArtifactUrls.bootloader ||
        !serverArtifactUrls.partitions ||
        !serverArtifactUrls.bootApp0)
    ) {
      return null;
    }

    const serverParts =
      serverArtifactUrls.bootloader && serverArtifactUrls.partitions && serverArtifactUrls.bootApp0
        ? [
            { path: serverArtifactUrls.bootloader, offset: ESP32_BOOTLOADER_OFFSET },
            { path: serverArtifactUrls.partitions, offset: ESP32_PARTITIONS_OFFSET },
            { path: serverArtifactUrls.bootApp0, offset: ESP32_BOOT_APP0_OFFSET },
            { path: serverArtifactUrls.firmware, offset: ESP32_APPLICATION_OFFSET },
          ]
        : [{ path: serverArtifactUrls.firmware, offset: getSingleBinaryOffset(board) }];

    return {
      name: `${projectName || board.name} (${board.name})`,
      version: "server-build",
      new_install_improv_wait_time: 0,
      builds: [
        {
          chipFamily: normalizeChipFamily(board),
          improv: false,
          parts: serverParts,
        },
      ],
    };
  }

  if (flashSource === "demo") {
    if (!board.demoFirmware) {
      return null;
    }

    return {
      name: `${projectName || board.name} (${board.name})`,
      version: "local-demo",
      new_install_improv_wait_time: 0,
      builds: [
        {
          chipFamily: normalizeChipFamily(board),
          improv: false,
          parts: board.demoFirmware.parts.map((part) => ({
            path: part.path,
            offset: part.offset,
          })),
        },
      ],
    };
  }

  return null;
}
