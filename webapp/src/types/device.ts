export type PinMode = "OUTPUT" | "INPUT" | "PWM" | "ANALOG";
export type PinType = "DIGITAL" | "ANALOG";

export interface PinConfig {
    pin: number;
    mode: PinMode;
    type: PinType;
    function: string;
    label: string;
    v_pin?: number;
    init?: string;
}

export interface HardwareConfig {
    pins: PinConfig[];
}

export interface Connectivity {
    protocol: string;
    broker: string;
    port: number;
    secure: boolean;
}

export interface DeviceInfo {
    uuid: string;
    name: string;
    board: string;
    mode: string;
    is_authorized: boolean;
    version: string;
    created_at: string;
}

export interface DeviceConfig {
    device: DeviceInfo;
    connectivity: Connectivity;
    hardware_config: HardwareConfig;
}
