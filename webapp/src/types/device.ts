export type PinMode = "INPUT" | "OUTPUT" | "PWM" | "ADC" | "I2C";
export type AuthStatus = "pending" | "approved" | "rejected";
export type ConnStatus = "online" | "offline";
export type DeviceMode = "no-code" | "library";

export interface DeviceAvailabilitySummary {
    device_id: string;
    room_id?: number;
    room_name?: string | null;
    auth_status: AuthStatus;
    conn_status: ConnStatus;
}

export interface PinConfig {
    id?: number;
    device_id?: string;
    gpio_pin: number;
    mode: PinMode;
    function?: string;
    label?: string;
    v_pin?: number;
    extra_params?: {
        active_level?: 0 | 1;
        [key: string]: unknown;
    } | null;
}

export interface DeviceConfig extends DeviceAvailabilitySummary {
    mac_address: string;
    name: string;
    mode: DeviceMode;
    board?: string;
    provider?: string;
    firmware_version?: string;
    ip_address?: string;
    topic_pub?: string;
    topic_sub?: string;
    owner_id?: number;
    created_at?: string;
    last_seen?: string;
    last_state?: {
        kind?: string;
        pin?: number;
        value?: number;
        applied?: boolean;
        brightness?: number;
        ip_address?: string;
        trend?: string;
    } | null;
    pin_configurations: PinConfig[];
}

export type DeviceDirectoryEntry = DeviceConfig | DeviceAvailabilitySummary;
