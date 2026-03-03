export type PinMode = "INPUT" | "OUTPUT" | "PWM" | "ADC" | "I2C";
export type AuthStatus = "pending" | "approved" | "rejected";
export type ConnStatus = "online" | "offline";
export type DeviceMode = "no-code" | "library";

export interface PinConfig {
    id?: number;
    device_id?: string;
    gpio_pin: number;
    mode: PinMode;
    function?: string;
    label?: string;
    v_pin?: number;
    extra_params?: Record<string, unknown> | null;
}

export interface DeviceConfig {
    device_id: string;
    mac_address: string;
    name: string;
    mode: DeviceMode;
    board?: string;
    provider?: string;
    firmware_version?: string;
    topic_pub?: string;
    topic_sub?: string;
    room_id?: number;
    owner_id?: number;
    auth_status: AuthStatus;
    conn_status: ConnStatus;
    created_at?: string;
    last_seen?: string;
    last_state?: {
        kind?: string;
        pin?: number;
        value?: number;
        applied?: boolean;
    } | null;
    pin_configurations: PinConfig[];
}
