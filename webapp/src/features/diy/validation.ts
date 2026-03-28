import type { BoardPin, BoardProfile } from "./board-profiles";
import type { PinMapping, ValidationResult } from "./types";

interface ValidatePinMappingsOptions {
  requireWifiCredentials?: boolean;
  wifiSsid?: string;
  wifiPassword?: string;
}

export function validatePinMappings(
  board: BoardProfile,
  pins: PinMapping[],
  options: ValidatePinMappingsOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownPins = new Map<number, BoardPin>(
    [...board.leftPins, ...board.rightPins].map((pin) => [pin.gpio, pin]),
  );
  const usedLabels = new Map<string, number>();
  let i2cPins = 0;

  if (options.requireWifiCredentials && !options.wifiSsid?.trim()) {
    errors.push("Enter the Wi-Fi SSID before building or flashing firmware.");
  }

  if (options.requireWifiCredentials && !options.wifiPassword?.trim()) {
    errors.push("Enter the Wi-Fi password before building or flashing firmware.");
  }

  if (pins.length === 0) {
    errors.push("Map at least one GPIO before generating config or flashing firmware.");
  }

  for (const mapping of pins) {
    const boardPin = knownPins.get(mapping.gpio_pin);

    if (!boardPin) {
      errors.push(`GPIO ${mapping.gpio_pin} is not exposed by the selected board profile.`);
      continue;
    }

    if (!boardPin.capabilities.includes(mapping.mode)) {
      errors.push(`GPIO ${mapping.gpio_pin} does not support ${mapping.mode} on ${board.name}.`);
    }

    if (boardPin.inputOnly && mapping.mode !== "INPUT" && mapping.mode !== "ADC") {
      errors.push(`GPIO ${mapping.gpio_pin} is input-only and cannot drive outputs.`);
    }

    if (boardPin.reserved) {
      errors.push(
        `GPIO ${mapping.gpio_pin} is reserved or tightly coupled to boot / USB functions on ${board.name}.`,
      );
    }

    if (boardPin.bootSensitive && (mapping.mode === "OUTPUT" || mapping.mode === "PWM")) {
      warnings.push(
        `GPIO ${mapping.gpio_pin} is boot-sensitive. Confirm the connected circuit will not pull the line during reset.`,
      );
    }

    if (mapping.mode === "I2C") {
      i2cPins += 1;
    }

    const normalizedLabel = (mapping.label || "").trim().toLowerCase();
    if (normalizedLabel) {
      usedLabels.set(normalizedLabel, (usedLabels.get(normalizedLabel) ?? 0) + 1);
    }
  }

  if (i2cPins === 1) {
    errors.push("I2C needs both SDA and SCL. Map two I2C-capable pins before flashing.");
  }

  for (const [label, count] of usedLabels.entries()) {
    if (count > 1) {
      warnings.push(`The label "${label}" is used on multiple GPIOs. Rename them to avoid widget confusion.`);
    }
  }

  return { errors, warnings };
}
