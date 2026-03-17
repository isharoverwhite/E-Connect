import { AuthStatus, DeviceConfig, DeviceDirectoryEntry } from "@/types/device";
import { getToken } from "./auth";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_URL = configuredApiUrl && configuredApiUrl.length > 0
    ? configuredApiUrl.replace(/\/$/, "")
    : "/api/v1";

export interface DeviceCommandResponse {
    status: string;
    message?: string;
    command?: unknown;
}

export async function approveDiscoveredDevice(uuid: string, roomId: number): Promise<boolean> {
    try {
        const token = getToken();
        if (!token) return false;

        const res = await fetch(`${API_URL}/device/${uuid}/approve`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ room_id: roomId })
        });

        return res.ok;
    } catch (error) {
        console.error("Failed to approve device:", error);
        return false;
    }
}

export async function fetchDevices(options?: { authStatus?: AuthStatus }): Promise<DeviceDirectoryEntry[]> {
    try {
        const token = getToken();
        if (!token) return [];
        const query = new URLSearchParams();
        if (options?.authStatus) {
            query.set("auth_status", options.authStatus);
        }
        const suffix = query.toString() ? `?${query.toString()}` : "";

        const res = await fetch(`${API_URL}/devices${suffix}`, {
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

export async function fetchDashboardDevices(): Promise<DeviceConfig[]> {
    try {
        const token = getToken();
        if (!token) return [];

        const res = await fetch(`${API_URL}/dashboard/devices`, {
            cache: "no-store",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!res.ok) return [];
        return res.json();
    } catch (error) {
        console.error("Failed to fetch dashboard devices:", error);
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

export async function saveDeviceConfig(
    uuid: string,
    config: { pins: unknown[] }
): Promise<{ status: string; job_id?: string; message?: string }> {
    try {
        const token = getToken();
        if (!token) return { status: "failed", message: "No token" };

        const res = await fetch(`${API_URL}/device/${uuid}/config`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(config)
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            return { status: "failed", message: errorData.detail || "HTTP Error" };
        }
        return res.json();
    } catch (error) {
        console.error("Failed to save device config:", error);
        return { status: "failed", message: "Network error" };
    }
}
