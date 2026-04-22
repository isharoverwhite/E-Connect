/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { PinMode } from "@/types/device";

export type ChipFamily =
  | "ESP32"
  | "ESP32-S2"
  | "ESP32-S3"
  | "ESP32-C2"
  | "ESP32-C3"
  | "ESP32-C5"
  | "ESP32-C6"
  | "ESP32-C61"
  | "ESP32-H2"
  | "ESP32-P4"
  | "ESP8266";

export interface BoardPin {
  id: string;
  gpio: number;
  label: string;
  side: "left" | "right";
  capabilities: PinMode[];
  note?: string;
  reserved?: boolean;
  bootSensitive?: boolean;
  inputOnly?: boolean;
}

export interface DemoFirmwarePart {
  offset: number;
  path: string;
  label: string;
}

export interface DemoFirmwarePreset {
  title: string;
  parts: DemoFirmwarePart[];
  notes: string[];
}

export interface BoardProfile {
  id: string;
  name: string;
  family: ChipFamily;
  chipLabel: string;
  description: string;
  layoutLabel: string;
  serialBridge: string;
  warnings: string[];
  leftPins: BoardPin[];
  rightPins: BoardPin[];
  demoFirmware?: DemoFirmwarePreset;
  defaultCpuMhz?: number;
  defaultFlashSize?: string;
  defaultPsram?: string;
  i2cDefaults?: {
    sda: number;
    scl: number;
  };
}

export interface BoardFamilyInfo {
  id: ChipFamily;
  title: string;
  subtitle: string;
  accent: string;
  specs: {
    core: string;
    clock: string;
    wireless: string;
  };
}

const pin = (
  gpio: number,
  label: string,
  side: "left" | "right",
  capabilities: PinMode[],
  options: Omit<BoardPin, "id" | "gpio" | "label" | "side" | "capabilities"> = {},
): BoardPin => ({
  id: `gpio-${gpio}`,
  gpio,
  label,
  side,
  capabilities,
  ...options,
});

const IO = ["INPUT", "OUTPUT", "PWM"] satisfies PinMode[];
const IO_ADC = ["INPUT", "OUTPUT", "PWM", "ADC"] satisfies PinMode[];
const INPUT_ADC = ["INPUT", "ADC"] satisfies PinMode[];
const INPUT_ONLY = ["INPUT"] satisfies PinMode[];
const ADC_ONLY = ["ADC"] satisfies PinMode[];
const I2C_IO = ["INPUT", "OUTPUT", "I2C"] satisfies PinMode[];

export const BOARD_FAMILIES: BoardFamilyInfo[] = [
  {
    id: "ESP32",
    title: "ESP32",
    subtitle: "Classic dual-core boards and camera-ready modules.",
    accent: "from-sky-500 to-blue-600",
    specs: {
      core: "Dual-core Xtensa® LX6",
      clock: "240 MHz",
      wireless: "Wi-Fi 4, BLE 4.2",
    },
  },
  {
    id: "ESP8266",
    title: "ESP8266",
    subtitle: "The original compact Wi-Fi MCU that started it all.",
    accent: "from-cyan-600 to-sky-700",
    specs: {
      core: "Single-core Tensilica L106",
      clock: "80 MHz",
      wireless: "Wi-Fi 4",
    },
  },
  {
    id: "ESP32-S2",
    title: "ESP32-S2",
    subtitle: "USB-native single-core boards for compact local-first nodes.",
    accent: "from-cyan-500 to-sky-500",
    specs: {
      core: "Single-core Xtensa® LX7",
      clock: "240 MHz",
      wireless: "Wi-Fi 4",
    },
  },
  {
    id: "ESP32-S3",
    title: "ESP32-S3",
    subtitle: "USB-native boards for richer peripherals and more demanding local workloads.",
    accent: "from-blue-500 to-indigo-500",
    specs: {
      core: "Dual-core Xtensa® LX7",
      clock: "240 MHz",
      wireless: "Wi-Fi 4, BLE 5.0",
    },
  },
  {
    id: "ESP32-C2",
    title: "ESP32-C2",
    subtitle: "Entry-class compact Wi-Fi/BLE footprint.",
    accent: "from-emerald-500 to-green-500",
    specs: {
      core: "Single-core RISC-V",
      clock: "120 MHz",
      wireless: "Wi-Fi 4, BLE 5.0",
    },
  },
  {
    id: "ESP32-C3",
    title: "ESP32-C3",
    subtitle: "RISC-V boards with strong DIY and web-flash support.",
    accent: "from-lime-500 to-emerald-500",
    specs: {
      core: "Single-core RISC-V",
      clock: "160 MHz",
      wireless: "Wi-Fi 4, BLE 5.0",
    },
  },
  {
    id: "ESP32-C5",
    title: "ESP32-C5",
    subtitle: "Next-wave dual-band profile with generic reference layout.",
    accent: "from-teal-500 to-emerald-600",
    specs: {
      core: "RISC-V Architecture",
      clock: "240 MHz",
      wireless: "Dual-band Wi-Fi 6, BLE 5.0",
    },
  },
  {
    id: "ESP32-C6",
    title: "ESP32-C6",
    subtitle: "Wi-Fi 6 and Thread-ready reference boards.",
    accent: "from-orange-500 to-amber-500",
    specs: {
      core: "Single-core RISC-V",
      clock: "160 MHz",
      wireless: "Wi-Fi 6, BLE 5.3, Thread",
    },
  },
  {
    id: "ESP32-C61",
    title: "ESP32-C61",
    subtitle: "New reference-series profile with compact GPIO bank.",
    accent: "from-amber-500 to-yellow-500",
    specs: {
      core: "Single-core RISC-V",
      clock: "160 MHz",
      wireless: "Wi-Fi 6, BLE 5.0",
    },
  },
  {
    id: "ESP32-H2",
    title: "ESP32-H2",
    subtitle: "Matter and Thread-focused low-power boards.",
    accent: "from-fuchsia-500 to-pink-500",
    specs: {
      core: "Single-core RISC-V",
      clock: "96 MHz",
      wireless: "BLE 5.2, Thread, Zigbee",
    },
  },
  {
    id: "ESP32-P4",
    title: "ESP32-P4",
    subtitle: "High-end reference board for richer I/O surfaces.",
    accent: "from-violet-500 to-purple-500",
    specs: {
      core: "Dual-core RISC-V",
      clock: "400 MHz",
      wireless: "None (External)",
    },
  },
];

const classicEsp32Left = [
  pin(36, "VP", "left", INPUT_ADC, { inputOnly: true, note: "Input only ADC pin." }),
  pin(39, "VN", "left", INPUT_ADC, { inputOnly: true, note: "Input only ADC pin." }),
  pin(34, "GPIO34", "left", INPUT_ADC, { inputOnly: true, note: "Input only ADC pin." }),
  pin(35, "GPIO35", "left", INPUT_ADC, { inputOnly: true, note: "Input only ADC pin." }),
  pin(32, "GPIO32", "left", IO_ADC),
  pin(33, "GPIO33", "left", IO_ADC),
  pin(25, "GPIO25", "left", IO_ADC),
  pin(26, "GPIO26", "left", IO_ADC),
  pin(27, "GPIO27", "left", IO),
  pin(14, "GPIO14", "left", IO, { bootSensitive: true, note: "Boot strap pin. Avoid hard pull-ups." }),
  pin(12, "GPIO12", "left", IO, { bootSensitive: true, note: "Flash voltage strap pin." }),
  pin(13, "GPIO13", "left", IO),
];

const classicEsp32Right = [
  pin(23, "GPIO23", "right", IO),
  pin(22, "GPIO22", "right", I2C_IO, { note: "Often used as default I2C SCL." }),
  pin(21, "GPIO21", "right", I2C_IO, { note: "Often used as default I2C SDA." }),
  pin(19, "GPIO19", "right", IO),
  pin(18, "GPIO18", "right", IO),
  pin(5, "GPIO5", "right", IO, { bootSensitive: true, note: "Keep state stable during boot." }),
  pin(17, "GPIO17", "right", IO),
  pin(16, "GPIO16", "right", IO),
  pin(4, "GPIO4", "right", IO_ADC, { bootSensitive: true }),
  pin(2, "GPIO2", "right", IO_ADC, { bootSensitive: true, note: "Built-in LED on some boards." }),
  pin(15, "GPIO15", "right", IO, { bootSensitive: true }),
  pin(0, "GPIO0", "right", IO_ADC, { reserved: true, bootSensitive: true, note: "Boot button / download mode pin." }),
];

const esp32S2Left = [
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO_ADC),
  pin(3, "GPIO3", "left", IO_ADC),
  pin(4, "GPIO4", "left", IO_ADC),
  pin(5, "GPIO5", "left", IO_ADC),
  pin(6, "GPIO6", "left", IO_ADC),
  pin(7, "GPIO7", "left", IO_ADC),
  pin(8, "GPIO8", "left", IO_ADC),
  pin(9, "GPIO9", "left", IO_ADC),
];

const esp32S2Right = [
  pin(10, "GPIO10", "right", IO_ADC),
  pin(11, "GPIO11", "right", IO_ADC),
  pin(12, "GPIO12", "right", IO_ADC),
  pin(13, "GPIO13", "right", IO_ADC),
  pin(14, "GPIO14", "right", IO_ADC),
  pin(15, "GPIO15", "right", IO_ADC),
  pin(16, "GPIO16", "right", I2C_IO),
  pin(17, "GPIO17", "right", I2C_IO),
  pin(18, "GPIO18", "right", IO, { reserved: true, note: "Native USB D- on USB capable variants." }),
  pin(19, "GPIO19", "right", IO, { reserved: true, note: "Native USB D+ on USB capable variants." }),
];

const esp32S3Left = [
  pin(4, "GPIO4", "left", IO),
  pin(5, "GPIO5", "left", IO),
  pin(6, "GPIO6", "left", IO),
  pin(7, "GPIO7", "left", IO),
  pin(15, "GPIO15", "left", IO),
  pin(16, "GPIO16", "left", IO),
  pin(17, "GPIO17", "left", IO),
  pin(18, "GPIO18", "left", IO, { reserved: true, note: "USB / default peripheral wiring on some variants." }),
  pin(8, "GPIO8", "left", IO),
  pin(3, "GPIO3", "left", IO),
];

const esp32S3Right = [
  pin(46, "GPIO46", "right", INPUT_ONLY, { inputOnly: true, reserved: true, note: "Input-only strapping pin." }),
  pin(9, "GPIO9", "right", IO),
  pin(10, "GPIO10", "right", IO),
  pin(11, "GPIO11", "right", IO),
  pin(12, "GPIO12", "right", IO),
  pin(13, "GPIO13", "right", IO),
  pin(14, "GPIO14", "right", IO),
  pin(21, "GPIO21", "right", IO_ADC),
  pin(47, "GPIO47", "right", IO),
  pin(48, "GPIO48", "right", IO, { note: "RGB LED on many compact S3 boards." }),
];

const esp32C2Left = [
  pin(0, "GPIO0", "left", IO_ADC, { reserved: true, bootSensitive: true, note: "Boot strap pin." }),
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO),
  pin(3, "GPIO3", "left", IO_ADC),
  pin(4, "GPIO4", "left", I2C_IO),
];

const esp32C2Right = [
  pin(5, "GPIO5", "right", I2C_IO),
  pin(6, "GPIO6", "right", IO),
  pin(7, "GPIO7", "right", IO),
  pin(8, "GPIO8", "right", IO),
  pin(10, "GPIO10", "right", IO_ADC),
];

const esp32C3Left = [
  pin(2, "GPIO2", "left", IO_ADC, { note: "ADC capable and common relay output." }),
  pin(3, "GPIO3", "left", IO_ADC),
  pin(4, "GPIO4", "left", IO_ADC),
  pin(5, "GPIO5", "left", IO_ADC),
  pin(6, "GPIO6", "left", I2C_IO),
  pin(7, "GPIO7", "left", I2C_IO),
  pin(8, "GPIO8", "left", IO, { bootSensitive: true, note: "Boot strap pin on many C3 boards." }),
];

const esp32C3SuperMiniLeft = [
  pin(-1, "5V", "left", [], { reserved: true, note: "5V Power Input" }),
  pin(-2, "GND", "left", [], { reserved: true, note: "Ground" }),
  pin(-3, "3.3V", "left", [], { reserved: true, note: "3.3V Power Output" }),
  pin(4, "GPIO4", "left", IO_ADC),
  pin(3, "GPIO3", "left", IO_ADC),
  pin(2, "GPIO2", "left", IO_ADC),
  pin(1, "GPIO1", "left", IO_ADC),
  pin(0, "GPIO0", "left", IO_ADC, { bootSensitive: true }),
];

const esp32C3Right = [
  pin(9, "GPIO9", "right", IO, { reserved: true, bootSensitive: true, note: "Boot button pin on many C3 boards." }),
  pin(10, "GPIO10", "right", IO, { reserved: true, note: "USB serial bridge or LED on some boards." }),
  pin(18, "GPIO18", "right", IO),
  pin(19, "GPIO19", "right", IO),
  pin(20, "GPIO20", "right", IO, { reserved: true, note: "USB D+ on USB-native variants." }),
  pin(21, "GPIO21", "right", IO, { reserved: true, note: "USB D- on USB-native variants." }),
];

const esp32C3SuperMiniRight = [
  pin(5, "GPIO5", "right", IO_ADC),
  pin(6, "GPIO6", "right", I2C_IO),
  pin(7, "GPIO7", "right", I2C_IO),
  pin(8, "GPIO8", "right", IO, { note: "Connected to Built-in LED (Blue)." }),
  pin(9, "GPIO9", "right", IO, { bootSensitive: true, note: "Boot button" }),
  pin(10, "GPIO10", "right", IO),
  pin(20, "GPIO20", "right", IO, { note: "USB D+ / RX" }),
  pin(21, "GPIO21", "right", IO, { note: "USB D- / TX" }),
];

const esp32C5Left = [
  pin(0, "GPIO0", "left", IO_ADC, { reserved: true, bootSensitive: true }),
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO),
  pin(3, "GPIO3", "left", I2C_IO),
  pin(4, "GPIO4", "left", I2C_IO),
  pin(5, "GPIO5", "left", IO),
];

const esp32C5Right = [
  pin(6, "GPIO6", "right", IO),
  pin(7, "GPIO7", "right", IO),
  pin(8, "GPIO8", "right", IO),
  pin(9, "GPIO9", "right", IO),
  pin(10, "GPIO10", "right", IO_ADC),
  pin(18, "GPIO18", "right", IO),
];

const esp32C6Left = [
  pin(0, "GPIO0", "left", IO_ADC, { reserved: true, bootSensitive: true }),
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO),
  pin(3, "GPIO3", "left", I2C_IO),
  pin(4, "GPIO4", "left", I2C_IO),
  pin(5, "GPIO5", "left", IO),
  pin(6, "GPIO6", "left", IO),
];

const esp32C6Right = [
  pin(7, "GPIO7", "right", IO),
  pin(8, "GPIO8", "right", IO),
  pin(9, "GPIO9", "right", IO),
  pin(10, "GPIO10", "right", IO),
  pin(18, "GPIO18", "right", IO),
  pin(19, "GPIO19", "right", IO),
  pin(20, "GPIO20", "right", IO),
];

const esp32C61Left = [
  pin(0, "GPIO0", "left", IO_ADC, { reserved: true, bootSensitive: true }),
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO),
  pin(3, "GPIO3", "left", I2C_IO),
  pin(4, "GPIO4", "left", I2C_IO),
  pin(5, "GPIO5", "left", IO),
];

const esp32C61Right = [
  pin(6, "GPIO6", "right", IO),
  pin(7, "GPIO7", "right", IO),
  pin(8, "GPIO8", "right", IO),
  pin(9, "GPIO9", "right", IO),
  pin(10, "GPIO10", "right", IO),
  pin(11, "GPIO11", "right", IO),
];

const esp32H2Left = [
  pin(0, "GPIO0", "left", IO, { reserved: true, bootSensitive: true }),
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO),
  pin(3, "GPIO3", "left", I2C_IO),
  pin(4, "GPIO4", "left", I2C_IO),
];

const esp32H2Right = [
  pin(5, "GPIO5", "right", IO),
  pin(6, "GPIO6", "right", IO),
  pin(7, "GPIO7", "right", IO),
  pin(8, "GPIO8", "right", IO),
  pin(9, "GPIO9", "right", IO),
];

const esp32P4Left = [
  pin(0, "GPIO0", "left", IO, { reserved: true, bootSensitive: true }),
  pin(1, "GPIO1", "left", IO),
  pin(2, "GPIO2", "left", IO),
  pin(3, "GPIO3", "left", IO),
  pin(4, "GPIO4", "left", I2C_IO),
  pin(5, "GPIO5", "left", I2C_IO),
  pin(6, "GPIO6", "left", IO),
];

const esp32P4Right = [
  pin(7, "GPIO7", "right", IO),
  pin(8, "GPIO8", "right", IO),
  pin(9, "GPIO9", "right", IO),
  pin(10, "GPIO10", "right", IO),
  pin(11, "GPIO11", "right", IO),
  pin(12, "GPIO12", "right", IO),
  pin(13, "GPIO13", "right", IO),
];

const nodemcuLeft = [
  pin(17, "A0", "left", ADC_ONLY, {
    inputOnly: true,
    note: "Single ADC input exposed as A0. Use ADC mode only.",
  }),
  pin(-1, "RSV", "left", [], { reserved: true }),
  pin(-2, "RSV", "left", [], { reserved: true }),
  pin(10, "SD3", "left", IO, { reserved: true, note: "Used for flash" }),
  pin(9, "SD2", "left", IO, { reserved: true, note: "Used for flash" }),
  pin(8, "SD1", "left", IO, { reserved: true, note: "Used for flash" }),
  pin(11, "CMD", "left", IO, { reserved: true, note: "Used for flash" }),
  pin(7, "SD0", "left", IO, { reserved: true, note: "Used for flash" }),
  pin(6, "CLK", "left", IO, { reserved: true, note: "Used for flash" }),
];

const nodemcuRight = [
  pin(16, "D0 (GPIO16)", "right", IO, { note: "General-purpose IO/PWM pin. Avoid using it for I2C." }),
  pin(5, "D1 (GPIO5)", "right", I2C_IO, { note: "Often used as SCL" }),
  pin(4, "D2 (GPIO4)", "right", I2C_IO, { note: "Often used as SDA" }),
  pin(0, "D3 (GPIO0)", "right", IO, { bootSensitive: true, note: "Boot strap pin" }),
  pin(2, "D4 (GPIO2)", "right", IO, { bootSensitive: true, note: "Built-in LED, Boot strap pin" }),
  pin(14, "D5 (GPIO14)", "right", IO, { note: "SPI SCK" }),
  pin(12, "D6 (GPIO12)", "right", IO, { note: "SPI MISO" }),
  pin(13, "D7 (GPIO13)", "right", IO, { note: "SPI MOSI" }),
  pin(15, "D8 (GPIO15)", "right", IO, { bootSensitive: true, note: "Boot strap pin" }),
  pin(3, "RX (GPIO3)", "right", IO, { reserved: true, note: "UART RX for flashing / logs." }),
  pin(1, "TX (GPIO1)", "right", IO, { reserved: true, note: "UART TX for flashing / boot logs." }),
];

const d1MiniLeft = [
  pin(-1, "RST", "left", [], { reserved: true }),
  pin(17, "A0", "left", ADC_ONLY, {
    inputOnly: true,
    note: "Single ADC input exposed as A0. Use ADC mode only.",
  }),
  pin(16, "D0 (GPIO16)", "left", IO, { note: "General-purpose IO/PWM pin. Avoid using it for I2C." }),
  pin(14, "D5 (GPIO14)", "left", IO),
  pin(12, "D6 (GPIO12)", "left", IO),
  pin(13, "D7 (GPIO13)", "left", IO),
  pin(15, "D8 (GPIO15)", "left", IO, { bootSensitive: true }),
  pin(-2, "3V3", "left", [], { reserved: true }),
];

const d1MiniRight = [
  pin(1, "TX (GPIO1)", "right", IO, { reserved: true, note: "UART TX for flashing / boot logs." }),
  pin(3, "RX (GPIO3)", "right", IO, { reserved: true, note: "UART RX for flashing / logs." }),
  pin(5, "D1 (GPIO5)", "right", I2C_IO),
  pin(4, "D2 (GPIO4)", "right", I2C_IO),
  pin(0, "D3 (GPIO0)", "right", IO, { bootSensitive: true }),
  pin(2, "D4 (GPIO2)", "right", IO, { bootSensitive: true, note: "Built-in LED" }),
  pin(-3, "GND", "right", [], { reserved: true }),
  pin(-4, "5V", "right", [], { reserved: true }),
];

const d1MiniProLeft = [...d1MiniLeft];
const d1MiniProRight = [...d1MiniRight];

const esp01Left = [
  pin(-1, "VCC", "left", [], { reserved: true }),
  pin(-2, "RST", "left", [], { reserved: true }),
  pin(-3, "CH_PD", "left", [], { reserved: true }),
  pin(1, "TX (GPIO1)", "left", IO, { reserved: true, note: "UART TX for flashing / boot logs." }),
];
const esp01Right = [
  pin(-4, "GND", "right", [], { reserved: true }),
  pin(2, "GPIO2", "right", IO, { bootSensitive: true }),
  pin(0, "GPIO0", "right", IO, { bootSensitive: true }),
  pin(3, "RX (GPIO3)", "right", IO, { reserved: true, note: "UART RX for flashing / logs." }),
];

const esp12eLeft = [
  pin(17, "A0", "left", ADC_ONLY, {
    inputOnly: true,
    note: "Single ADC input exposed as A0. Use ADC mode only.",
  }),
  pin(16, "GPIO16", "left", IO, { note: "General-purpose IO/PWM pin. Avoid using it for I2C." }),
  pin(14, "GPIO14", "left", IO, { note: "SPI SCK on many carrier boards." }),
  pin(12, "GPIO12", "left", IO, { note: "SPI MISO on many carrier boards." }),
  pin(13, "GPIO13", "left", IO, { note: "SPI MOSI on many carrier boards." }),
  pin(15, "GPIO15", "left", IO, { bootSensitive: true, note: "Boot strap pin." }),
];

const esp12eRight = [
  pin(5, "GPIO5", "right", I2C_IO, { note: "Typical I2C SCL on ESP8266." }),
  pin(4, "GPIO4", "right", I2C_IO, { note: "Typical I2C SDA on ESP8266." }),
  pin(0, "GPIO0", "right", IO, { bootSensitive: true, note: "Boot strap pin." }),
  pin(2, "GPIO2", "right", IO, { bootSensitive: true, note: "Boot strap pin." }),
  pin(3, "GPIO3", "right", IO, { reserved: true, note: "UART RX for flashing / logs." }),
  pin(1, "GPIO1", "right", IO, { reserved: true, note: "UART TX for flashing / boot logs." }),
];

export const BOARD_PROFILES: BoardProfile[] = [
  {
    id: "esp32-devkit-v1",
    name: "ESP32 DevKit V1",
    family: "ESP32",
    chipLabel: "ESP32-WROOM-32",
    description: "Classic 30-pin dev board for relays, dimmers, sensors, and MQTT nodes.",
    layoutLabel: "30-pin breadboard layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "GPIO 0, 2, 4, 5, 12, 14, and 15 are boot-sensitive on many ESP32 boards.",
      "GPIO 34-39 are input-only and should be used for sensors or buttons only.",
    ],
    leftPins: classicEsp32Left,
    rightPins: classicEsp32Right,
    i2cDefaults: { sda: 21, scl: 22 },
  },
  {
    id: "nodemcuv2",
    name: "NodeMCU (v2/v3)",
    family: "ESP8266",
    chipLabel: "ESP-12E / ESP8266",
    description: "Classic widely-available generic ESP8266 dev board.",
    layoutLabel: "NodeMCU Layout",
    serialBridge: "USB-to-UART bridge (CP2102 / CH340)",
    warnings: [
      "GPIO 0, 2, 15 are boot strap pins. Do not hold them inappropriately during reset.",
      "GPIO 1 and 3 stay reserved for serial flashing and boot logs.",
    ],
    leftPins: nodemcuLeft,
    rightPins: nodemcuRight,
    defaultCpuMhz: 80,
    defaultFlashSize: "4MB",
    defaultPsram: "None",
    i2cDefaults: { sda: 4, scl: 5 },
  },
  {
    id: "d1_mini",
    name: "WeMos D1 mini",
    family: "ESP8266",
    chipLabel: "ESP-12S / ESP8266",
    description: "Compact widely-available ESP8266 dev board.",
    layoutLabel: "D1 Mini Layout",
    serialBridge: "USB-to-UART bridge (CH340 / CP2104)",
    warnings: [
      "Boot strap pins must not be held low on startup.",
      "GPIO 1 and 3 stay reserved for serial flashing and boot logs.",
    ],
    leftPins: d1MiniLeft,
    rightPins: d1MiniRight,
    defaultCpuMhz: 80,
    defaultFlashSize: "4MB",
    defaultPsram: "None",
    i2cDefaults: { sda: 4, scl: 5 },
  },
  {
    id: "d1_mini_pro",
    name: "WeMos D1 mini Pro",
    family: "ESP8266",
    chipLabel: "ESP-12F / ESP8266",
    description: "D1 mini Pro variant with larger flash and external antenna option.",
    layoutLabel: "D1 Mini Pro Layout",
    serialBridge: "USB-to-UART bridge (CH340 / CP2104)",
    warnings: [
      "Boot strap pins must not be held low on startup.",
      "GPIO 1 and 3 stay reserved for serial flashing and boot logs.",
    ],
    leftPins: d1MiniProLeft,
    rightPins: d1MiniProRight,
    defaultCpuMhz: 80,
    defaultFlashSize: "16MB",
    defaultPsram: "None",
    i2cDefaults: { sda: 4, scl: 5 },
  },
  {
    id: "esp01_1m",
    name: "ESP-01 / ESP-01S (1MB)",
    family: "ESP8266",
    chipLabel: "ESP8266",
    description: "Barebones module with 1MB flash.",
    layoutLabel: "2x4 pin header",
    serialBridge: "External 3.3V USB-to-UART adapter required",
    warnings: [
      "Requires external USB adapter and manual boot state jumping to flash.",
      "Only 4 GPIOs available, 2 of them are TX/RX.",
    ],
    leftPins: esp01Left,
    rightPins: esp01Right,
    defaultCpuMhz: 80,
    defaultFlashSize: "1MB",
    defaultPsram: "None",
  },
  {
    id: "esp12e",
    name: "ESP-12E / ESP-12F Module",
    family: "ESP8266",
    chipLabel: "ESP-12E/F",
    description: "Module-grade ESP8266 profile for custom carrier boards and soldered projects.",
    layoutLabel: "Module breakout layout",
    serialBridge: "External 3.3V USB-to-UART adapter required",
    warnings: [
      "GPIO 0, 2, 15 are boot strap pins. Confirm pull resistors on your carrier board.",
      "GPIO 1 and 3 stay reserved for serial flashing and boot logs.",
    ],
    leftPins: esp12eLeft,
    rightPins: esp12eRight,
    defaultCpuMhz: 80,
    defaultFlashSize: "4MB",
    defaultPsram: "None",
    i2cDefaults: { sda: 4, scl: 5 },
  },
  {
    id: "esp32-wrover-devkit",
    name: "ESP32 WROVER DevKit",
    family: "ESP32",
    chipLabel: "ESP32-WROVER",
    description: "PSRAM-ready variant for larger dashboards and richer automation payloads.",
    layoutLabel: "38-pin devkit layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "Avoid boot-sensitive pins for relays that may pull the line during reset.",
      "PSRAM and flash lines are not exposed in this simplified mapping and remain reserved.",
    ],
    leftPins: classicEsp32Left,
    rightPins: classicEsp32Right,
    i2cDefaults: { sda: 21, scl: 22 },
  },
  {
    id: "esp32-cam",
    name: "ESP32-CAM",
    family: "ESP32",
    chipLabel: "ESP32-S Camera",
    description: "Camera-first board profile with a reduced GPIO bank for motion and snapshot nodes.",
    layoutLabel: "Compact camera module layout",
    serialBridge: "External USB serial required",
    warnings: [
      "Camera wiring consumes several GPIOs; only exposed safe pins are listed here.",
      "Use dedicated power and stable 5V supply before web flashing.",
    ],
    leftPins: [
      pin(1, "GPIO1", "left", IO),
      pin(3, "GPIO3", "left", INPUT_ONLY, { note: "UART RX on many ESP32-CAM adapters." }),
      pin(4, "GPIO4", "left", IO, { note: "On-board flash LED on many modules." }),
      pin(12, "GPIO12", "left", IO, { bootSensitive: true }),
      pin(13, "GPIO13", "left", IO),
      pin(14, "GPIO14", "left", IO),
    ],
    rightPins: [
      pin(15, "GPIO15", "right", IO, { bootSensitive: true }),
      pin(16, "GPIO16", "right", IO),
      pin(2, "GPIO2", "right", IO, { bootSensitive: true }),
      pin(0, "GPIO0", "right", IO, { reserved: true, bootSensitive: true }),
      pin(33, "GPIO33", "right", IO),
      pin(32, "GPIO32", "right", IO),
    ],
  },
  {
    id: "esp32-s2-saola-1",
    name: "ESP32-S2 Saola-1",
    family: "ESP32-S2",
    chipLabel: "ESP32-S2-WROVER",
    description: "Official USB-native S2 dev kit profile for sensors and secure provisioning nodes.",
    layoutLabel: "Native USB devkit layout",
    serialBridge: "Native USB CDC",
    warnings: [
      "USB data pins are exposed and should stay free if you rely on native USB flashing.",
      "Single-core S2 boards excel at sensors and captive portal provisioning, not heavy UI workloads.",
    ],
    leftPins: esp32S2Left,
    rightPins: esp32S2Right,
    i2cDefaults: { sda: 8, scl: 9 },
  },
  {
    id: "lolin-s2-mini",
    name: "LOLIN S2 Mini",
    family: "ESP32-S2",
    chipLabel: "ESP32-S2 Mini",
    description: "Compact S2 layout for battery-powered area sensors and touch controls.",
    layoutLabel: "Mini 2x10 layout",
    serialBridge: "Native USB CDC",
    warnings: [
      "Keep USB pins free for the smoothest web flashing experience.",
      "Mini boards often share pins with LEDs and sensors; double-check any vendor-specific accessories.",
    ],
    leftPins: esp32S2Left.slice(0, 7),
    rightPins: esp32S2Right.slice(0, 7),
  },
  {
    id: "esp32-s3-devkitc-1",
    name: "ESP32-S3 DevKitC-1",
    family: "ESP32-S3",
    chipLabel: "ESP32-S3-WROOM-1",
    description: "Primary S3 profile for richer UI nodes, RGB lighting, and local ML-adjacent projects.",
    layoutLabel: "Dual-row USB native layout",
    serialBridge: "Native USB CDC / UART",
    warnings: [
      "GPIO 46 is input-only and not safe for relay or PWM outputs.",
      "USB pins and RGB LED pins vary by vendor board, so keep GPIO 18, 20, 47, and 48 under review.",
    ],
    leftPins: esp32S3Left,
    rightPins: esp32S3Right,
    i2cDefaults: { sda: 8, scl: 9 },
  },
  {
    id: "esp32-s3-zero",
    name: "ESP32-S3 Zero",
    family: "ESP32-S3",
    chipLabel: "ESP32-S3 Zero",
    description: "Compact S3 board for USB-powered wall switches and dashboards.",
    layoutLabel: "Compact S3 layout",
    serialBridge: "Native USB CDC",
    warnings: [
      "Compact boards have fewer safe GPIOs; avoid using reserved USB lines for actuators.",
      "GPIO 48 commonly drives the onboard RGB LED.",
    ],
    leftPins: esp32S3Left.slice(0, 7),
    rightPins: esp32S3Right.slice(0, 7),
  },
  {
    id: "esp32-c2-reference",
    name: "ESP32-C2 Reference Board",
    family: "ESP32-C2",
    chipLabel: "ESP32-C2",
    description: "Generic C2 profile for minimal local-first endpoints.",
    layoutLabel: "Compact reference layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "C2 boards have a small GPIO budget; plan sensors and outputs carefully.",
      "GPIO 0 remains boot-sensitive and should not be tied to active-low peripherals.",
    ],
    leftPins: esp32C2Left,
    rightPins: esp32C2Right,
  },
  {
    id: "esp32-c3-devkitm-1",
    name: "ESP32-C3 DevKitM-1",
    family: "ESP32-C3",
    chipLabel: "ESP32-C3-MINI-1",
    description: "Official C3 dev kit profile with solid browser-flash ergonomics.",
    layoutLabel: "RISC-V mini devkit layout",
    serialBridge: "Native USB / UART bridge",
    warnings: [
      "GPIO 8 and 9 are boot-sensitive on many C3 boards.",
      "USB lines vary by carrier board; if flashing fails, remove peripheral wiring from GPIO 20/21.",
    ],
    leftPins: esp32C3Left,
    rightPins: esp32C3Right,
    i2cDefaults: { sda: 8, scl: 9 },
  },
  {
    id: "esp32-c3-super-mini",
    name: "ESP32-C3 Super Mini",
    family: "ESP32-C3",
    chipLabel: "ESP32-C3",
    description: "Ultra-compact C3 board with native USB-C and built-in blue LED on GPIO 8.",
    layoutLabel: "Super Mini 2x8 layout",
    serialBridge: "Native USB CDC",
    warnings: [
      "GPIO 8 is connected to the built-in LED.",
      "GPIO 9 is boot-sensitive.",
    ],
    leftPins: esp32C3SuperMiniLeft,
    rightPins: esp32C3SuperMiniRight,
    i2cDefaults: { sda: 8, scl: 9 },
  },
  {
    id: "dfrobot-beetle-esp32-c3",
    name: "DFRobot Beetle ESP32-C3",
    family: "ESP32-C3",
    chipLabel: "DFR0975 / ESP32-C3",
    description: "Compact C3 board for custom local-first modules.",
    layoutLabel: "Beetle micro layout",
    serialBridge: "Native USB CDC",
    warnings: [
      "GPIO 9 remains tied to boot mode on many Beetle C3 workflows.",
    ],
    leftPins: esp32C3Left.slice(0, 5),
    rightPins: esp32C3Right.slice(0, 5),
  },
  {
    id: "esp32-c5-reference",
    name: "ESP32-C5 Reference Board",
    family: "ESP32-C5",
    chipLabel: "ESP32-C5",
    description: "Generic C5 profile ready for future dual-band board support.",
    layoutLabel: "Reference dual-band layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "Use your own firmware artifacts for C5 until the repo includes a compiled demo.",
      "Review vendor-specific antenna and RF notes before enclosure deployment.",
    ],
    leftPins: esp32C5Left,
    rightPins: esp32C5Right,
  },
  {
    id: "esp32-c6-devkitc-1",
    name: "ESP32-C6 DevKitC-1",
    family: "ESP32-C6",
    chipLabel: "ESP32-C6-WROOM-1",
    description: "Wi-Fi 6 and Thread-ready profile for Matter-adjacent nodes.",
    layoutLabel: "Reference C6 devkit layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "Use your own Matter or Thread-capable firmware bundle before web flashing.",
      "GPIO 0 remains the safest pin to avoid for outputs due to boot behavior.",
    ],
    leftPins: esp32C6Left,
    rightPins: esp32C6Right,
  },
  {
    id: "esp32-c61-reference",
    name: "ESP32-C61 Reference Board",
    family: "ESP32-C61",
    chipLabel: "ESP32-C61",
    description: "Generic C61 reference profile for early support across the full ESP32 family range.",
    layoutLabel: "Reference compact layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "Use your own build artifacts for flashing until a repo-native C61 binary is available.",
      "Reference profile pin counts may differ from vendor carrier boards.",
    ],
    leftPins: esp32C61Left,
    rightPins: esp32C61Right,
  },
  {
    id: "esp32-h2-devkitm-1",
    name: "ESP32-H2 DevKitM-1",
    family: "ESP32-H2",
    chipLabel: "ESP32-H2",
    description: "Thread and Zigbee-focused profile for low-power automation nodes.",
    layoutLabel: "Low-power radio devkit layout",
    serialBridge: "USB-to-UART bridge",
    warnings: [
      "Use your own firmware bundle for H2 boards; only the config and SVG mapping are prebuilt here.",
      "GPIO budgets are tight, so reserve at least one line for commissioning and debug.",
    ],
    leftPins: esp32H2Left,
    rightPins: esp32H2Right,
  },
  {
    id: "esp32-p4-reference",
    name: "ESP32-P4 Reference Board",
    family: "ESP32-P4",
    chipLabel: "ESP32-P4",
    description: "High-end reference profile for richer interfaces and local processing experiments.",
    layoutLabel: "Expanded reference layout",
    serialBridge: "USB / external bridge depending on carrier",
    warnings: [
      "Use your own build artifacts for P4 until the repo includes a compiled example firmware.",
      "Reference layout captures the GPIO budget, not every vendor-specific connector.",
    ],
    leftPins: esp32P4Left,
    rightPins: esp32P4Right,
  },
];

export const MODE_METADATA: Record<
  PinMode,
  { label: string; description: string; color: string; icon: string; defaultFunction: string }
> = {
  INPUT: {
    label: "Digital Input",
    description: "Buttons, reed switches, dry contacts, PIR triggers.",
    color: "emerald",
    icon: "input",
    defaultFunction: "sensor",
  },
  OUTPUT: {
    label: "Digital Output",
    description: "Relays, LEDs, sirens, basic switch outputs.",
    color: "blue",
    icon: "toggle_on",
    defaultFunction: "relay",
  },
  PWM: {
    label: "PWM Output",
    description: "Dimmers, fan control, analog-style actuators.",
    color: "violet",
    icon: "speed",
    defaultFunction: "dimmer",
  },
  ADC: {
    label: "Analog Input",
    description: "Photoresistors, thermistors, analog sensors.",
    color: "amber",
    icon: "thermostat",
    defaultFunction: "sensor",
  },
  I2C: {
    label: "I2C Bus",
    description: "Shared bus line for displays, RTC, and environmental sensors.",
    color: "orange",
    icon: "lan",
    defaultFunction: "i2c",
  },
};

export const COMPONENT_TEMPLATES: Array<{
  id: string;
  title: string;
  mode: PinMode;
  function: string;
  labelPrefix: string;
  description: string;
}> = [
    {
      id: "relay",
      title: "Relay / Switch",
      mode: "OUTPUT",
      function: "relay",
      labelPrefix: "Relay",
      description: "Simple on/off output for lights, relays, and garage triggers.",
    },
    {
      id: "led",
      title: "LED / Status Light",
      mode: "OUTPUT",
      function: "light",
      labelPrefix: "Status LED",
      description: "Visible output that mirrors device state.",
    },
    {
      id: "dimmer",
      title: "Dimmer / Fan",
      mode: "PWM",
      function: "dimmer",
      labelPrefix: "Dimmer",
      description: "Variable output for dimmable lights or fan control.",
    },
    {
      id: "analog-sensor",
      title: "Analog Sensor",
      mode: "ADC",
      function: "sensor",
      labelPrefix: "Analog Sensor",
      description: "ADC-backed analog telemetry input.",
    },
    {
      id: "button",
      title: "Button / Reed",
      mode: "INPUT",
      function: "button",
      labelPrefix: "Button",
      description: "Discrete input for wall buttons and contact sensors.",
    },
    {
      id: "i2c",
      title: "I2C Bus",
      mode: "I2C",
      function: "i2c",
      labelPrefix: "I2C",
      description: "Shared communication line for SDA or SCL roles.",
    },
  ];

export function getBoardFamily(id: ChipFamily): BoardFamilyInfo | undefined {
  return BOARD_FAMILIES.find((family) => family.id === id);
}

function normalizeBoardProfileId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

export function getBoardProfile(id: string): BoardProfile | undefined {
  const normalized = normalizeBoardProfileId(id);
  return BOARD_PROFILES.find(
    (profile) =>
      profile.id === id ||
      normalizeBoardProfileId(profile.id) === normalized ||
      normalizeBoardProfileId(profile.name) === normalized,
  );
}

const BOARD_PROFILE_ALIASES: Record<string, string> = {
  "esp32": "esp32-devkit-v1",
  "esp32-devkit-v1": "esp32-devkit-v1",
  "esp32-wrover-kit": "esp32-wrover-devkit",
  "esp32-wrover-devkit": "esp32-wrover-devkit",
  "esp32-cam": "esp32-cam",
  "esp32-s2": "esp32-s2-saola-1",
  "esp32-s2-saola-1": "esp32-s2-saola-1",
  "esp32-s3": "esp32-s3-devkitc-1",
  "esp32-s3-devkitc-1": "esp32-s3-devkitc-1",
  "esp32-c2": "esp32-c2-reference",
  "esp32-c2-reference": "esp32-c2-reference",
  "esp32-c3": "esp32-c3-devkitm-1",
  "esp32-c3-devkitm-1": "esp32-c3-devkitm-1",
  "dfrobot-beetle-esp32-c3": "dfrobot-beetle-esp32-c3",
  "esp32-c5": "esp32-c5-reference",
  "esp32-c5-reference": "esp32-c5-reference",
  "esp32-c6": "esp32-c6-devkitc-1",
  "esp32-c6-devkitc-1": "esp32-c6-devkitc-1",
  "esp32-c61": "esp32-c61-reference",
  "esp32-c61-reference": "esp32-c61-reference",
  "esp32-h2": "esp32-h2-devkitm-1",
  "esp32-h2-devkitm-1": "esp32-h2-devkitm-1",
  "esp32-p4": "esp32-p4-reference",
  "esp32-p4-reference": "esp32-p4-reference",
  "esp8266": "nodemcuv2",
  "esp8266-nodemcu": "nodemcuv2",
  "nodemcu": "nodemcuv2",
  "nodemcu-v2": "nodemcuv2",
  "nodemcu-v3": "nodemcuv2",
  "nodemcuv2": "nodemcuv2",
  "node-mcu-v2-v3": "nodemcuv2",
  "d1-mini": "d1_mini",
  "wemos-d1-mini": "d1_mini",
  "d1_mini": "d1_mini",
  "d1-mini-pro": "d1_mini_pro",
  "wemos-d1-mini-pro": "d1_mini_pro",
  "d1_mini_pro": "d1_mini_pro",
  "esp-01": "esp01_1m",
  "esp-01s": "esp01_1m",
  "esp01": "esp01_1m",
  "esp01-1m": "esp01_1m",
  "esp01_1m": "esp01_1m",
  "esp-12e": "esp12e",
  "esp-12f": "esp12e",
  "esp12e": "esp12e",
  "esp12f": "esp12e",
};

export function resolveBoardProfileId(id: string): string | undefined {
  const normalized = normalizeBoardProfileId(id);
  const directMatch = getBoardProfile(normalized);

  if (directMatch) {
    return directMatch.id;
  }

  if (BOARD_PROFILE_ALIASES[normalized]) {
    return BOARD_PROFILE_ALIASES[normalized];
  }

  if (normalized.includes("d1-mini-pro")) {
    return "d1_mini_pro";
  }
  if (normalized.includes("d1-mini")) {
    return "d1_mini";
  }
  if (normalized.includes("esp-01")) {
    return "esp01_1m";
  }
  if (normalized.includes("esp-12")) {
    return "esp12e";
  }
  if (normalized.includes("esp8266") || normalized.includes("nodemcu")) {
    return "nodemcuv2";
  }
  if (normalized.includes("c3")) {
    return "esp32-c3-devkitm-1";
  }
  if (normalized.includes("s3")) {
    return "esp32-s3-devkitc-1";
  }
  if (normalized.includes("s2")) {
    return "esp32-s2-saola-1";
  }
  if (normalized.includes("c2")) {
    return "esp32-c2-reference";
  }
  if (normalized.includes("c5")) {
    return "esp32-c5-reference";
  }
  if (normalized.includes("c6")) {
    return "esp32-c6-devkitc-1";
  }
  if (normalized.includes("h2")) {
    return "esp32-h2-devkitm-1";
  }
  if (normalized.includes("p4")) {
    return "esp32-p4-reference";
  }
  if (normalized.includes("esp32")) {
    return "esp32-devkit-v1";
  }

  return undefined;
}
