/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { DeviceConfig } from "@/types/device";

export type ExternalCardType = "light" | "switch" | "fan" | "sensor";

const SUPPORTED_EXTERNAL_CARD_TYPES = new Set<ExternalCardType>(["light", "switch", "fan", "sensor"]);

const DEVICE_TYPE_LABELS: Record<string, string> = {
  camera: "Camera",
  climate: "Climate",
  cover: "Cover",
  custom: "Custom",
  fan: "Fan",
  light: "Light",
  lock: "Lock",
  outlet: "Outlet",
  sensor: "Sensor",
  switch: "Switch",
};

const DEVICE_TYPE_ICONS: Record<string, string> = {
  camera: "videocam",
  climate: "device_thermostat",
  cover: "blinds",
  custom: "developer_board",
  fan: "mode_fan",
  light: "wb_incandescent",
  lock: "lock",
  outlet: "power",
  sensor: "sensors",
  switch: "toggle_on",
};

type DeviceLike = Pick<
  DeviceConfig,
  "device_type" | "provider" | "installed_extension_id" | "is_external" | "schema_snapshot"
>;

function normalizeDeviceType(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readSchemaSnapshotObject(
  schemaSnapshot: DeviceLike["schema_snapshot"],
): Record<string, unknown> | null {
  if (!schemaSnapshot || typeof schemaSnapshot !== "object" || Array.isArray(schemaSnapshot)) {
    return null;
  }

  return schemaSnapshot as Record<string, unknown>;
}

function readSchemaDisplayObject(
  schemaSnapshot: DeviceLike["schema_snapshot"],
): Record<string, unknown> | null {
  const schemaObject = readSchemaSnapshotObject(schemaSnapshot);
  const rawDisplay = schemaObject?.display;
  if (!rawDisplay || typeof rawDisplay !== "object" || Array.isArray(rawDisplay)) {
    return null;
  }

  return rawDisplay as Record<string, unknown>;
}

export function isExternalDevice(config: DeviceLike): boolean {
  return Boolean(config.provider || config.installed_extension_id || config.is_external);
}

export function getSchemaCardType(config: DeviceLike): string | null {
  const display = readSchemaDisplayObject(config.schema_snapshot);
  return normalizeDeviceType(typeof display?.card_type === "string" ? display.card_type : null);
}

export function getExternalCardType(config: DeviceLike): ExternalCardType | null {
  if (!isExternalDevice(config)) {
    return null;
  }

  const schemaCardType = getSchemaCardType(config);
  if (schemaCardType && SUPPORTED_EXTERNAL_CARD_TYPES.has(schemaCardType as ExternalCardType)) {
    return schemaCardType as ExternalCardType;
  }

  return "light";
}

export function getDeviceType(config: DeviceLike): string {
  const directDeviceType = normalizeDeviceType(config.device_type);
  if (directDeviceType) {
    return directDeviceType;
  }

  const schemaObject = readSchemaSnapshotObject(config.schema_snapshot);
  const schemaDeviceType = normalizeDeviceType(
    typeof schemaObject?.device_type === "string" ? schemaObject.device_type : null,
  );
  if (schemaDeviceType) {
    return schemaDeviceType;
  }

  const schemaCardType = getSchemaCardType(config);
  if (schemaCardType) {
    return schemaCardType;
  }

  return isExternalDevice(config) ? "light" : "custom";
}

export function formatDeviceTypeLabel(deviceType: string | null | undefined): string {
  const normalized = normalizeDeviceType(deviceType);
  if (!normalized) {
    return "Device";
  }

  return (
    DEVICE_TYPE_LABELS[normalized] ||
    normalized
      .split(/[_-]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ")
  );
}

export function getDeviceTypeIcon(deviceType: string | null | undefined): string {
  const normalized = normalizeDeviceType(deviceType);
  if (!normalized) {
    return "devices_other";
  }

  return DEVICE_TYPE_ICONS[normalized] || "devices_other";
}

export function usesDedicatedExternalLightCard(config: DeviceLike): boolean {
  return getExternalCardType(config) === "light";
}

export function usesDedicatedExternalCard(config: DeviceLike): boolean {
  return getExternalCardType(config) !== null;
}
