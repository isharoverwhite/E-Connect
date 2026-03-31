import { API_URL } from "./api";
import { getToken } from "./auth";

export interface WifiCredentialRecord {
    id: number;
    household_id: number;
    ssid: string;
    masked_password: string;
    usage_count: number;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface WifiCredentialSecretRecord {
    id: number;
    ssid: string;
    password: string;
}

async function parseWifiCredentialError(response: Response) {
    const fallback = "Wi-Fi credential request failed";

    try {
        const payload = (await response.json()) as {
            detail?: string | { message?: string; error?: string };
            message?: string;
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

        if (payload.message) {
            return payload.message;
        }
    } catch {
        return fallback;
    }

    return fallback;
}

function requireToken(token?: string) {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }
    return authToken;
}

export async function fetchWifiCredentials(token?: string): Promise<WifiCredentialRecord[]> {
    const authToken = requireToken(token);
    const response = await fetch(`${API_URL}/wifi-credentials`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseWifiCredentialError(response));
    }

    return response.json();
}

export async function createWifiCredential(
    payload: { ssid: string; password: string },
    token?: string,
): Promise<WifiCredentialRecord> {
    const authToken = requireToken(token);
    const response = await fetch(`${API_URL}/wifi-credentials`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(await parseWifiCredentialError(response));
    }

    return response.json();
}

export async function updateWifiCredential(
    credentialId: number,
    payload: { ssid: string; password: string },
    token?: string,
): Promise<WifiCredentialRecord> {
    const authToken = requireToken(token);
    const response = await fetch(`${API_URL}/wifi-credentials/${credentialId}`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(await parseWifiCredentialError(response));
    }

    return response.json();
}

export async function deleteWifiCredential(credentialId: number, token?: string): Promise<void> {
    const authToken = requireToken(token);
    const response = await fetch(`${API_URL}/wifi-credentials/${credentialId}`, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseWifiCredentialError(response));
    }
}

export async function revealWifiCredentialPassword(
    credentialId: number,
    password: string,
    token?: string,
): Promise<WifiCredentialSecretRecord> {
    const authToken = requireToken(token);
    const response = await fetch(`${API_URL}/wifi-credentials/${credentialId}/reveal`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
    });

    if (!response.ok) {
        throw new Error(await parseWifiCredentialError(response));
    }

    return response.json();
}
