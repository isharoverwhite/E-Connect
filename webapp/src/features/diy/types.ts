import type { PinMode } from "@/types/device";

export interface PinMapping {
    gpio_pin: number;
    mode: PinMode;
    function?: string;
    label?: string;
}

export interface FirmwareUploadState {
    bootloader: File | null;
    partitions: File | null;
    firmware: File | null;
}

export interface ValidationResult {
    errors: string[];
    warnings: string[];
}

export interface FlashManifest {
    name: string;
    version: string;
    builds: Array<{
        chipFamily: string;
        parts: Array<{
            path: string;
            offset: number;
        }>;
    }>;
}

export const MODE_ORDER: PinMode[] = ["OUTPUT", "PWM", "INPUT", "ADC", "I2C"];
export const MODE_BADGE_STYLES: Record<PinMode, string> = {
    INPUT:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    OUTPUT:
        "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300",
    PWM: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300",
    ADC: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
    I2C: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300",
};

export const PIN_FILL: Record<"idle" | "selected" | "assigned" | "reserved", string> = {
    idle: "#facc15",
    selected: "#3b82f6",
    assigned: "#22c55e",
    reserved: "#94a3b8",
};

export function sanitizePins(input: PinMapping[], modeMetadata: Record<string, unknown>): PinMapping[] {
    return input
        .filter(
            (item): item is PinMapping =>
                typeof item.gpio_pin === "number" &&
                typeof item.mode === "string" &&
                item.mode in modeMetadata,
        )
        .map((item) => ({
            gpio_pin: item.gpio_pin,
            mode: item.mode,
            function: item.function,
            label: item.label,
        }))
        .sort((left, right) => left.gpio_pin - right.gpio_pin);
}
