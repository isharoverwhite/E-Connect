import { DeviceConfig } from "@/types/device";
import { getToken } from "./auth";

export const API_URL = "http://127.0.0.1:8000/api/v1";

export interface DeviceCommandResponse {
    status: string;
    message?: string;
    command?: unknown;
}

export async function fetchDevices(): Promise<DeviceConfig[]> {
    try {
        const token = getToken();
        if (!token) return [];

        const res = await fetch(`${API_URL}/devices`, {
            cache: "no-store",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (!res.ok) return [];
        return res.json();
    } catch (error) {
        console.error("Failed to fetch devices:", error);
        return [];
    }
}

export async function fetchDevice(uuid: string): Promise<DeviceConfig | null> {
    try {
        const token = getToken();
        const headers: HeadersInit = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_URL}/device/${uuid}`, {
            cache: "no-store",
            headers
        });

        if (!res.ok) return null;
        return res.json();
    } catch (error) {
        console.error("Failed to fetch device:", error);
        return null;
    }
}

export async function deleteDevice(uuid: string): Promise<boolean> {
    try {
        const token = getToken();
        if (!token) return false;

        const res = await fetch(`${API_URL}/device/${uuid}`, {
            method: "DELETE",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        return res.ok;
    } catch (error) {
        console.error("Failed to delete device:", error);
        return false;
    }
}

export async function sendDeviceCommand(
    uuid: string,
    payload: Record<string, unknown>
): Promise<DeviceCommandResponse> {
    try {
        const token = getToken();
        if (!token) return { status: "failed", message: "No token" };

        const res = await fetch(`${API_URL}/device/${uuid}/command`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            return { status: "failed", message: "HTTP Error" };
        }
        return res.json();
    } catch (error) {
        console.error("Failed to send command:", error);
        return { status: "failed", message: "Network error" };
    }
}
