import { API_URL } from "./api";

export type UserApprovalStatus = "pending" | "approved" | "revoked";
export type ManagedHouseholdRole = "owner" | "admin" | "member" | "guest";

export interface ManagedUser {
    user_id: number;
    fullname: string;
    username: string;
    account_type: "admin" | "parent" | "child";
    approval_status: UserApprovalStatus;
    household_role?: ManagedHouseholdRole | null;
    created_at?: string | null;
    ui_layout?: unknown;
}

// --- Token Management ---

export const setToken = (token: string) => {
    if (typeof window !== "undefined") {
        localStorage.setItem("econnect_token", token);
    }
};

export const getToken = (): string | null => {
    if (typeof window !== "undefined") {
        return localStorage.getItem("econnect_token");
    }
    return null;
};

export const removeToken = () => {
    if (typeof window !== "undefined") {
        localStorage.removeItem("econnect_token");
    }
};


// --- Auth API Calls ---

export async function loginUser(credentials: FormData) {
    const res = await fetch(`${API_URL}/auth/token`, {
        method: "POST",
        body: credentials,
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const detail = errorData.detail;
        if (detail?.message) {
            throw new Error(detail.message);
        }
        if (typeof detail === "string") {
            throw new Error(detail);
        }
        throw new Error("Incorrect username or password");
    }

    return res.json();
}

export async function initializeServer(data: object) {
    const res = await fetch(`${API_URL}/auth/initialserver`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        let errorMessage = "Failed to initialize server";
        if (Array.isArray(errorData.detail) && errorData.detail.length > 0 && errorData.detail[0].msg) {
            errorMessage = errorData.detail[0].msg;
        } else if (errorData.detail?.message) {
            errorMessage = errorData.detail.message;
        } else if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
        } else if (errorData.detail?.error) {
            errorMessage = errorData.detail.error; // Custom errors like {"error": "system_initialized"}
        }
        throw new Error(errorMessage);
    }

    return res.json();
}

export async function adminCreateUser(data: object, token: string): Promise<ManagedUser> {
    const res = await fetch(`${API_URL}/users`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(data),
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.detail || "Failed to create user");
    }

    return res.json();
}

export async function fetchManagedUsers(token: string): Promise<ManagedUser[]> {
    const res = await fetch(`${API_URL}/users`, {
        headers: {
            "Authorization": `Bearer ${token}`,
        },
        cache: "no-store",
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.detail || "Failed to load users");
    }

    return res.json();
}

export async function approveManagedUser(userId: number, token: string): Promise<ManagedUser> {
    const res = await fetch(`${API_URL}/users/${userId}/approve`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.detail || "Failed to approve user");
    }

    return res.json();
}

export async function revokeManagedUser(userId: number, token: string): Promise<ManagedUser> {
    const res = await fetch(`${API_URL}/users/${userId}/revoke`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.detail || "Failed to revoke user");
    }

    return res.json();
}

export async function fetchMyProfile() {
    const token = getToken();
    if (!token) throw new Error("No token available");

    const res = await fetch(`${API_URL}/users/me`, {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    if (!res.ok) {
        if (res.status === 401) {
            removeToken(); // Invalid token, cleanup
        }
        throw new Error("Failed to fetch profile");
    }

    return res.json();
}

export async function fetchSystemStatus() {
    const res = await fetch(`${API_URL}/system/status`);
    if (!res.ok) throw new Error("Failed to check system status");
    return res.json();
}
