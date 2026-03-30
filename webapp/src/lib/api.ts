import { AuthStatus, DeviceConfig, DeviceDirectoryEntry } from "@/types/device";
import { getToken } from "./auth";
import { buildProvisioningHeaders, resolvePublicApiBaseUrl } from "./secure-origin";

export const API_URL = resolvePublicApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);

export interface DeviceCommandResponse {
    status: string;
    message?: string;
    command_id?: string;
    command?: unknown;
}

export interface RuntimeNetworkInfo {
    advertised_host: string;
    api_base_url: string;
    mqtt_broker: string;
    mqtt_port: number;
    webapp_protocol: string;
    webapp_port: number;
    target_key: string;
    warning?: string | null;
    stale_project_count?: number;
    stale_device_count?: number;
    cpu_percent: number;
    memory_used: number;
    memory_total: number;
    storage_used: number;
    storage_total: number;
}

async function parseApiError(response: Response, fallback: string) {
    try {
        const payload = (await response.json()) as {
            detail?: string | { message?: string; error?: string };
        };

        if (typeof payload.detail === "string") {
            return payload.detail;
        }

        if (payload.detail?.message) {
            return payload.detail.message;
        }

        if (payload.detail?.error) {
            return payload.detail.error;
        }
    } catch {
        return fallback;
    }

    return fallback;
}

export async function fetchRuntimeNetworkInfo(token?: string): Promise<RuntimeNetworkInfo> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/diy/network-targets`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
            ...buildProvisioningHeaders(),
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load runtime network targets"));
    }

    return response.json();
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

export async function rejectDiscoveredDevice(uuid: string): Promise<boolean> {
    try {
        const token = getToken();
        if (!token) return false;

        const res = await fetch(`${API_URL}/device/${uuid}/reject`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
            },
        });

        return res.ok;
    } catch (error) {
        console.error("Failed to reject device:", error);
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
            return { status: "failed", message: await parseApiError(res, "Failed to send device command") };
        }
        return res.json();
    } catch (error) {
        console.error("Failed to send command:", error);
        return { status: "failed", message: "Network error" };
    }
}

export async function saveDeviceConfig(
    uuid: string,
    config: { pins: unknown[]; password: string }
): Promise<{ status: string; job_id?: string; message?: string }> {
    try {
        const token = getToken();
        if (!token) return { status: "failed", message: "No token" };

        const res = await fetch(`${API_URL}/device/${uuid}/config`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                ...buildProvisioningHeaders(),
            },
            body: JSON.stringify(config)
        });

        if (!res.ok) {
            return { status: "failed", message: await parseApiError(res, "Failed to save device config") };
        }
        return res.json();
    } catch (error) {
        console.error("Failed to save device config:", error);
        return { status: "failed", message: "Network error" };
    }
}
