/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

export type PinMode = "INPUT" | "OUTPUT" | "PWM" | "ADC" | "I2C";
export type AuthStatus = "pending" | "approved" | "rejected";
export type ConnStatus = "online" | "offline";
export type DeviceMode = "no-code" | "library" | "portableDashboard";

export interface PinExtraParams {
    active_level?: 0 | 1;
    min_value?: number;
    max_value?: number;
    subtype?: "on_off" | "pwm";
    i2c_role?: "SDA" | "SCL";
    i2c_address?: string;
    i2c_library?: string;
    [key: string]: unknown;
}

export interface DeviceAvailabilitySummary {
    device_id: string;
    room_id?: number;
    room_name?: string | null;
    auth_status: AuthStatus;
    conn_status: ConnStatus;
    pairing_requested_at?: string | null;
}

export interface PinConfig {
    id?: number;
    device_id?: string;
    gpio_pin: number;
    mode: PinMode;
    function?: string;
    label?: string;
    v_pin?: number;
    extra_params?: PinExtraParams | null;
}

export interface DeviceStatePin {
    pin: number;
    mode?: string;
    function?: string;
    label?: string;
    value?: number | boolean;
    brightness?: number;
    active_level?: 0 | 1;
    extra_params?: PinExtraParams | null;
    trend?: string;
    unit?: string;
    datatype?: "number" | "boolean";
}

export interface DeviceStateSnapshot {
    kind?: string;
    device_id?: string;
    pin?: number;
    value?: number | boolean;
    applied?: boolean;
    firmware_revision?: string;
    firmware_version?: string;
    brightness?: number;
    color_temperature?: number;
    rgb?: {
        r: number;
        g: number;
        b: number;
    };
    color_mode?: number;
    capabilities?: string[];
    ip_address?: string;
    trend?: string;
    unit?: string;
    pins?: DeviceStatePin[];
}

export interface DeviceConfig extends DeviceAvailabilitySummary {
    mac_address: string;
    name: string;
    mode: DeviceMode;
    board?: string;
    provider?: string;
    extension_name?: string;
    installed_extension_id?: string;
    device_schema_id?: string;
    external_config?: Record<string, unknown> | null;
    schema_snapshot?: Record<string, unknown> | null;
    is_external?: boolean;
    firmware_revision?: string;
    firmware_version?: string;
    ip_address?: string;
    topic_pub?: string;
    topic_sub?: string;
    owner_id?: number;
    created_at?: string;
    updated_at?: string;
    last_seen?: string;
    pairing_requested_at?: string | null;
    last_state?: DeviceStateSnapshot | null;
    last_delivery?: {
        status: "acknowledged" | "failed";
        command_id?: string;
        reason?: string;
    } | null;
    provisioning_project_id?: string;
    pin_configurations: PinConfig[];
}

export type DeviceDirectoryEntry = DeviceConfig | DeviceAvailabilitySummary;
