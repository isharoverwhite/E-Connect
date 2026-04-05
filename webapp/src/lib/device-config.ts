/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { DeviceConfig, DeviceStatePin, DeviceStateSnapshot, PinConfig, PinMode } from "@/types/device";

const VALID_PIN_MODES: ReadonlySet<PinMode> = new Set(["INPUT", "OUTPUT", "PWM", "ADC", "I2C"]);

type ComparablePinInput = {
  gpio_pin: number;
  mode: string;
  function?: string | null;
  label?: string | null;
  extra_params?: Record<string, unknown> | null;
};

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeExtraParams(
  mode: PinMode,
  value: unknown,
  fallback?: {
    active_level?: number;
  },
): PinConfig["extra_params"] {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const normalized: Record<string, unknown> = {};

  if (mode === "OUTPUT") {
    const activeLevel =
      source.active_level === 0 || source.active_level === 1
        ? source.active_level
        : fallback?.active_level === 0 || fallback?.active_level === 1
          ? fallback.active_level
          : undefined;
    if (activeLevel === 0 || activeLevel === 1) {
      normalized.active_level = activeLevel;
    }
  }

  if (mode === "PWM") {
    if (typeof source.min_value === "number") {
      normalized.min_value = source.min_value;
    }
    if (typeof source.max_value === "number") {
      normalized.max_value = source.max_value;
    }
    if (typeof source.subtype === "string" && source.subtype.trim()) {
      normalized.subtype = source.subtype.trim();
    }
  }

  if (mode === "I2C") {
    if (typeof source.i2c_role === "string" && source.i2c_role.trim()) {
      normalized.i2c_role = source.i2c_role.trim();
    }
    if (typeof source.i2c_address === "string" && source.i2c_address.trim()) {
      normalized.i2c_address = source.i2c_address.trim();
    }
    if (typeof source.i2c_library === "string" && source.i2c_library.trim()) {
      normalized.i2c_library = source.i2c_library.trim();
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeComparablePin(pin: ComparablePinInput) {
  const mode = pin.mode.toUpperCase() as PinMode;
  if (typeof pin.gpio_pin !== "number" || !VALID_PIN_MODES.has(mode)) {
    return null;
  }

  return {
    gpio_pin: pin.gpio_pin,
    mode,
    function: readTrimmedString(pin.function) ?? null,
    label: readTrimmedString(pin.label) ?? null,
    extra_params: normalizeExtraParams(mode, pin.extra_params) ?? null,
  };
}

export function getStatePins(state: DeviceStateSnapshot | null | undefined): DeviceStatePin[] {
  if (!Array.isArray(state?.pins)) {
    return [];
  }

  return state.pins.filter((pin): pin is DeviceStatePin => typeof pin?.pin === "number");
}

export function mapRuntimePinsToPinConfigurations(
  state: DeviceStateSnapshot | null | undefined,
): PinConfig[] {
  const runtimePins: Array<PinConfig | null> = getStatePins(state).map((pin) => {
    const rawMode = readTrimmedString(pin.mode)?.toUpperCase();
    if (!rawMode || !VALID_PIN_MODES.has(rawMode as PinMode)) {
      return null;
    }

    const mode = rawMode as PinMode;
    return {
      gpio_pin: pin.pin,
      mode,
      function: readTrimmedString(pin.function),
      label: readTrimmedString(pin.label),
      extra_params: normalizeExtraParams(mode, pin.extra_params, {
        active_level: pin.active_level,
      }),
    };
  });

  return runtimePins
    .filter((pin): pin is PinConfig => pin !== null)
    .sort((left, right) => left.gpio_pin - right.gpio_pin);
}

export function getActivePinConfigurations(
  device: Pick<DeviceConfig, "pin_configurations" | "last_state"> | null | undefined,
): PinConfig[] {
  const runtimePins = mapRuntimePinsToPinConfigurations(device?.last_state);
  if (runtimePins.length > 0) {
    return runtimePins;
  }

  return [...(device?.pin_configurations ?? [])].sort((left, right) => left.gpio_pin - right.gpio_pin);
}

export function arePinConfigurationsEquivalent(
  left: ReadonlyArray<ComparablePinInput>,
  right: ReadonlyArray<ComparablePinInput>,
): boolean {
  const normalizedLeft = left
    .map(normalizeComparablePin)
    .filter((pin): pin is NonNullable<ReturnType<typeof normalizeComparablePin>> => pin !== null)
    .sort((a, b) => a.gpio_pin - b.gpio_pin);
  const normalizedRight = right
    .map(normalizeComparablePin)
    .filter((pin): pin is NonNullable<ReturnType<typeof normalizeComparablePin>> => pin !== null)
    .sort((a, b) => a.gpio_pin - b.gpio_pin);

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}
