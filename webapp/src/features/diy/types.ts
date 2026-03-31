import type { PinMode } from "@/types/device";

export interface I2CLibrary {
    name: string;
    display_name: string;
    category: string;
    description: string;
    default_address?: string;
    pio_lib_deps: string[];
    supported_channels: string[];
    is_writable: boolean;
}

export interface PinMapping {
    gpio_pin: number;
    mode: PinMode;
    function?: string;
    label?: string;
    extra_params?: {
        subtype?: "on_off" | "pwm";
        active_level?: 0 | 1;
        min_value?: number;
        max_value?: number;
        i2c_role?: "SDA" | "SCL";
        i2c_address?: string;
        i2c_library?: string;
    } | null;
}

export type FlashSource = "server" | "demo";

export type ProjectSyncState = "idle" | "loading" | "saving" | "saved" | "error";

export type BuildJobStatus =
    | "draft_config"
    | "validated"
    | "queued"
    | "building"
    | "artifact_ready"
    | "flashing"
    | "flashed"
    | "build_failed"
    | "flash_failed"
    | "cancelled";

export interface ValidationResult {
    errors: string[];
    warnings: string[];
}

export interface FlashManifest {
    name: string;
    version: string;
    new_install_improv_wait_time?: number;
    builds: Array<{
        chipFamily: string;
        improv?: boolean;
        parts: Array<{
            path: string;
            offset: number;
        }>;
    }>;
}

export interface ServerBuildState {
    jobId: string | null;
    status: BuildJobStatus | "idle";
    logs: string;
    error: string | null;
    warnings: string[];
    artifactUrl: string | null;
    artifactName: string | null;
    bootloaderUrl: string | null;
    partitionsUrl: string | null;
    configKey: string | null;
    updatedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
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

export function sanitizePins(input: unknown[], modeMetadata: Record<string, unknown>): PinMapping[] {
    const sanitizedPins: PinMapping[] = [];

    for (const item of input) {
        if (!item || typeof item !== "object") {
            continue;
        }

        const candidate = item as PinMapping & { gpio?: unknown };
        const gpio =
            typeof candidate.gpio_pin === "number"
                ? candidate.gpio_pin
                : typeof candidate.gpio === "number"
                    ? candidate.gpio
                    : null;

        if (gpio === null || typeof candidate.mode !== "string" || !(candidate.mode in modeMetadata)) {
            continue;
        }

        const nextPin: PinMapping = {
            gpio_pin: gpio,
            mode: candidate.mode as PinMode,
        };

        if (typeof candidate.function === "string" && candidate.function.length > 0) {
            nextPin.function = candidate.function;
        }

        if (typeof candidate.label === "string" && candidate.label.length > 0) {
            nextPin.label = candidate.label;
        }

        if (candidate.extra_params && typeof candidate.extra_params === "object") {
            nextPin.extra_params = {};
            
            const ep = candidate.extra_params as Record<string, unknown>;
            
            if ("subtype" in ep && (ep.subtype === "on_off" || ep.subtype === "pwm")) {
                nextPin.extra_params.subtype = ep.subtype as "on_off" | "pwm";
            }
            if ("active_level" in ep && (ep.active_level === 0 || ep.active_level === 1)) {
                nextPin.extra_params.active_level = ep.active_level as 0 | 1;
            }
            if ("min_value" in ep && typeof ep.min_value === "number") {
                nextPin.extra_params.min_value = ep.min_value;
            }
            if ("max_value" in ep && typeof ep.max_value === "number") {
                nextPin.extra_params.max_value = ep.max_value;
            }
            if ("i2c_role" in ep && (ep.i2c_role === "SDA" || ep.i2c_role === "SCL")) {
                nextPin.extra_params.i2c_role = ep.i2c_role as "SDA" | "SCL";
            }
            if ("i2c_address" in ep && typeof ep.i2c_address === "string") {
                nextPin.extra_params.i2c_address = ep.i2c_address;
            }
            if ("i2c_library" in ep && typeof ep.i2c_library === "string") {
                nextPin.extra_params.i2c_library = ep.i2c_library;
            }
        }

        sanitizedPins.push(nextPin);
    }

    return sanitizedPins.sort((left, right) => left.gpio_pin - right.gpio_pin);
}
