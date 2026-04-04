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

export interface DeviceConfigHistoryEntry {
    id: string;
    project_id: string;
    device_id: string;
    board_profile: string;
    config_name: string;
    assigned_device_id?: string | null;
    assigned_device_name?: string | null;
    created_at: string;
    updated_at: string;
    last_applied_at?: string | null;
    latest_build_job_id?: string | null;
    latest_build_status?: string | null;
    latest_build_finished_at?: string | null;
    latest_build_error?: string | null;
    expected_firmware_version?: string | null;
    is_pending: boolean;
    is_committed: boolean;
    config: Record<string, unknown>;
}

export type SystemLogSeverity = "info" | "warning" | "error" | "critical";
export type SystemLogCategory = "lifecycle" | "connectivity" | "firmware" | "health";
export type SystemOverallStatus = "healthy" | "warning" | "critical";

export interface SystemLogEntry {
    id: number;
    occurred_at: string;
    severity: SystemLogSeverity;
    category: SystemLogCategory;
    event_code: string;
    message: string;
    device_id?: string | null;
    firmware_version?: string | null;
    firmware_revision?: string | null;
    details?: Record<string, unknown> | null;
    is_read: boolean;
    read_at?: string | null;
    read_by_user_id?: number | null;
}

export interface SystemLogListResponse {
    entries: SystemLogEntry[];
    total: number;
    retention_days: number;
    effective_timezone: string;
    timezone_source: "setting" | "runtime";
    current_server_time: string;
    oldest_occurred_at?: string | null;
    latest_occurred_at?: string | null;
}

export interface SystemStatusResponse {
    overall_status: SystemOverallStatus;
    database_status: string;
    mqtt_status: string;
    started_at?: string | null;
    uptime_seconds: number;
    advertised_host?: string | null;
    cpu_percent: number;
    memory_used: number;
    memory_total: number;
    storage_used: number;
    storage_total: number;
    retention_days: number;
    active_alert_count: number;
    effective_timezone: string;
    timezone_source: "setting" | "runtime";
    current_server_time: string;
    latest_alert_at?: string | null;
    latest_alert_message?: string | null;
    latest_firmware_revision?: string | null;
}

export interface SystemLogAcknowledgeResponse {
    updated_count: number;
}

export interface GeneralSettingsResponse {
    household_id: number;
    configured_timezone?: string | null;
    effective_timezone: string;
    timezone_source: "setting" | "runtime";
    current_server_time: string;
    timezone_options: string[];
}

export interface ServerTimeContextResponse {
    effective_timezone: string;
    timezone_source: "setting" | "runtime";
    current_server_time: string;
}

export interface ExtensionConfigField {
    key: string;
    label: string;
    type: "string" | "number" | "boolean";
    required: boolean;
}

export interface InstalledExtensionSchema {
    schema_id: string;
    name: string;
    default_name: string;
    description?: string | null;
    card_type: "light";
    capabilities: Array<"power" | "brightness" | "rgb" | "color_temperature">;
    temperature_range?: {
        min: number;
        max: number;
    } | null;
    config_fields: ExtensionConfigField[];
}

export interface InstalledExtension {
    extension_id: string;
    manifest_version: string;
    name: string;
    version: string;
    author?: string | null;
    description: string;
    provider_key: string;
    provider_name: string;
    package_runtime: string;
    package_entrypoint: string;
    package_root?: string | null;
    archive_sha256: string;
    manifest: Record<string, unknown>;
    device_schemas: InstalledExtensionSchema[];
    external_device_count: number;
    installed_at?: string | null;
    updated_at?: string | null;
}

export interface CreateExternalDevicePayload {
    installed_extension_id: string;
    device_schema_id: string;
    name?: string;
    room_id?: number | null;
    config?: Record<string, unknown>;
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

export async function fetchGeneralSettings(token?: string): Promise<GeneralSettingsResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/settings/general`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load general settings"));
    }

    return response.json();
}

export async function fetchServerTimeContext(token?: string): Promise<ServerTimeContextResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/system/time-context`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load server time context"));
    }

    return response.json();
}

export async function updateGeneralSettings(
    payload: { timezone: string | null },
    token?: string,
): Promise<GeneralSettingsResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/settings/general`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to update general settings"));
    }

    return response.json();
}

export async function fetchSystemStatus(token?: string): Promise<SystemStatusResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/system/live-status`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load system status"));
    }

    return response.json();
}

export async function fetchSystemLogs(token?: string, limit = 500): Promise<SystemLogListResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/system/logs?limit=${encodeURIComponent(String(limit))}`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load system logs"));
    }

    return response.json();
}

export async function markSystemLogRead(logId: number, token?: string): Promise<SystemLogAcknowledgeResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/system/logs/${encodeURIComponent(String(logId))}/read`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to mark alert as read"));
    }

    return response.json();
}

export async function markAllSystemLogsRead(token?: string): Promise<SystemLogAcknowledgeResponse> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/system/logs/mark-all-read`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to mark all alerts as read"));
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

export async function fetchInstalledExtensions(token?: string): Promise<InstalledExtension[]> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/extensions`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load installed extensions"));
    }

    return response.json();
}

export async function fetchExtension(extension_id: string, token?: string): Promise<InstalledExtension> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/extensions/${encodeURIComponent(extension_id)}`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, `Failed to load extension: ${extension_id}`));
    }

    return response.json();
}

export async function uploadExtensionZip(file: File, token?: string): Promise<InstalledExtension> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_URL}/extensions/upload`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        body: formData,
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to upload extension ZIP"));
    }

    return response.json();
}

export async function deleteInstalledExtension(
    extension_id: string,
    token?: string,
): Promise<{ status: string; extension_id: string }> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/extensions/${encodeURIComponent(extension_id)}`, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, `Failed to delete extension: ${extension_id}`));
    }

    return response.json();
}

export async function createExternalDevice(
    payload: CreateExternalDevicePayload,
    token?: string,
): Promise<DeviceConfig> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/external-devices`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create external device"));
    }

    return response.json();
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
    config: { pins: unknown[]; password?: string; wifi_credential_id?: number | null; config_name?: string; assigned_device_name?: string; config_id?: string; source_config_id?: string; create_new_config?: boolean }
): Promise<{ status: string; job_id?: string; config_id?: string; message?: string }> {
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

export async function fetchDeviceConfigHistory(
    uuid: string,
): Promise<DeviceConfigHistoryEntry[]> {
    const token = getToken();
    if (!token) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/device/${uuid}/config-history`, {
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load config history"));
    }

    return response.json();
}

export async function renameDeviceConfigHistory(
    uuid: string,
    jobId: string,
    configName: string
): Promise<{ status: string }> {
    const token = getToken();
    if (!token) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/device/${uuid}/config-history/${jobId}/name`, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ config_name: configName }),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to rename config history"));
    }

    return response.json();
}

export async function deleteDeviceConfigHistory(
    uuid: string,
    configId: string,
    password: string,
): Promise<{ status: string; id?: string }> {
    const token = getToken();
    if (!token) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/device/${uuid}/config-history/${configId}`, {
        method: "DELETE",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to delete config history"));
    }

    return response.json();
}

export async function fetchProjectConfigHistory(
    projectId: string
): Promise<DeviceConfigHistoryEntry[]> {
    const token = getToken();
    if (!token) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/diy/projects/${projectId}/config-history`, {
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load project config history"));
    }

    return response.json();
}


export const rebuildFirmware = async (
  deviceId: string,
  password?: string
): Promise<{ status: string; job_id: string; config_id: number; message: string }> => {
  const token = getToken();
  if (!token) {
    throw new Error("Missing session token. Please sign in again.");
  }

  const response = await fetch(`${API_URL}/device/${deviceId}/action/rebuild`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: password || "" }),
  });
  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    if (isJson) {
      const errorData = await response.json();
      const message = typeof errorData.detail === "object" ? errorData.detail.message : errorData.detail;
      throw new Error(message || "Failed to trigger firmware rebuild");
    } else {
      const textData = await response.text();
      console.error("Server returned non-JSON error:", textData);
      throw new Error(`Server Error: ${response.statusText}`);
    }
  }
  return response.json();
};
