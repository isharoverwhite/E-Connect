import { DeviceConfig } from "@/types/device";

const API_URL = "http://localhost:8000/api/v1";

export async function fetchDevices(): Promise<DeviceConfig[]> {
    try {
        const res = await fetch(`${API_URL}/devices`, { cache: "no-store" });
        if (!res.ok) return [];
        return res.json();
    } catch (error) {
        console.error("Failed to fetch devices:", error);
        return [];
    }
}

export async function fetchDevice(uuid: string): Promise<DeviceConfig | null> {
    try {
        const res = await fetch(`${API_URL}/device/${uuid}`, { cache: "no-store" });
        if (!res.ok) return null;
        return res.json();
    } catch (error) {
        console.error("Failed to fetch device:", error);
        return null;
    }
}
