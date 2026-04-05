/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { PinMapping } from "./types";

export interface ManagedConfigComparable {
  pins: PinMapping[];
  wifiCredentialId: number | null;
  assignedDeviceName: string;
}

interface ResolveManagedConfigEditorBaselineInput {
  loadedConfigId: string | null;
  currentConfigId: string | null;
  pendingConfigId: string | null;
  committed: ManagedConfigComparable;
  pending: ManagedConfigComparable | null;
  loaded: ManagedConfigComparable | null;
  fallback: ManagedConfigComparable;
}

function normalizeRecordKeys(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!record || typeof record !== "object") {
    return record ?? null;
  }

  const sorted: Record<string, unknown> = {};
  Object.keys(record)
    .sort()
    .forEach((key) => {
      sorted[key] = record[key];
    });
  return sorted;
}

export function normalizeManagedConfigPins(pins: PinMapping[]): PinMapping[] {
  return [...pins]
    .map((pin) => ({
      gpio_pin: pin.gpio_pin,
      mode: pin.mode,
      function: pin.function?.trim() || "",
      label: pin.label?.trim() || "",
      extra_params: normalizeRecordKeys(pin.extra_params),
    }))
    .sort((left, right) => left.gpio_pin - right.gpio_pin);
}

export function serializeManagedConfigPins(pins: PinMapping[]): string {
  return JSON.stringify(normalizeManagedConfigPins(pins));
}

export function doesManagedConfigMatch(
  current: ManagedConfigComparable,
  baseline: ManagedConfigComparable,
): boolean {
  return (
    serializeManagedConfigPins(current.pins) === serializeManagedConfigPins(baseline.pins) &&
    current.wifiCredentialId === baseline.wifiCredentialId &&
    current.assignedDeviceName === baseline.assignedDeviceName
  );
}

export function resolveManagedConfigEditorBaseline({
  loadedConfigId,
  currentConfigId,
  pendingConfigId,
  committed,
  pending,
  loaded,
  fallback,
}: ResolveManagedConfigEditorBaselineInput): ManagedConfigComparable {
  if (loadedConfigId !== null && loadedConfigId === pendingConfigId && pending) {
    return pending;
  }

  if (loadedConfigId !== null && loadedConfigId === currentConfigId) {
    return committed;
  }

  if (loaded) {
    return loaded;
  }

  return pending ?? fallback;
}
