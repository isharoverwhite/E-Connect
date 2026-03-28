import { API_URL } from "./api";

export type UserApprovalStatus = "pending" | "approved" | "revoked";
export type ManagedHouseholdRole = "owner" | "admin" | "member" | "guest";

const TOKEN_STORAGE_KEY = "econnect_token";
const SESSION_STORAGE_KEY = "econnect_session";

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

export interface AuthSession {
    access_token: string;
    refresh_token?: string | null;
    token_type: string;
    access_token_expires_at?: string | null;
    refresh_token_expires_at?: string | null;
    keep_login: boolean;
}

function isBrowser(): boolean {
    return typeof window !== "undefined";
}

function normalizeSession(session: AuthSession): AuthSession {
    return {
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? null,
        token_type: session.token_type || "bearer",
        access_token_expires_at: session.access_token_expires_at ?? null,
        refresh_token_expires_at: session.refresh_token_expires_at ?? null,
        keep_login: Boolean(session.keep_login),
    };
}

// --- Token Management ---

export const setToken = (value: string | AuthSession) => {
    if (!isBrowser()) {
        return;
    }

    if (typeof value === "string") {
        localStorage.setItem(TOKEN_STORAGE_KEY, value);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
    }

    const session = normalizeSession(value);
    localStorage.setItem(TOKEN_STORAGE_KEY, session.access_token);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const getSession = (): AuthSession | null => {
    if (!isBrowser()) {
        return null;
    }

    const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);
    if (rawSession) {
        try {
            const parsed = JSON.parse(rawSession) as Partial<AuthSession>;
            if (typeof parsed.access_token === "string" && parsed.access_token.length > 0) {
                return normalizeSession(parsed as AuthSession);
            }
        } catch {
            localStorage.removeItem(SESSION_STORAGE_KEY);
        }
    }

    const legacyToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!legacyToken) {
        return null;
    }

    return {
        access_token: legacyToken,
        refresh_token: null,
        token_type: "bearer",
        access_token_expires_at: null,
        refresh_token_expires_at: null,
        keep_login: false,
    };
};

export const getToken = (): string | null => {
    return getSession()?.access_token ?? null;
};

export const removeToken = () => {
    if (!isBrowser()) {
        return;
    }

    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(SESSION_STORAGE_KEY);
};

export async function refreshSession(): Promise<AuthSession | null> {
    const currentSession = getSession();
    if (!currentSession?.refresh_token) {
        return null;
    }

    const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: currentSession.refresh_token }),
    });

    if (!res.ok) {
        removeToken();
        return null;
    }

    const nextSession = normalizeSession(await res.json() as AuthSession);
    setToken(nextSession);
    return nextSession;
}

// --- Auth API Calls ---

export async function loginUser(credentials: FormData): Promise<AuthSession> {
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

    return normalizeSession(await res.json() as AuthSession);
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
        } else if (typeof errorData.detail === "string") {
            errorMessage = errorData.detail;
        } else if (errorData.detail?.error) {
            errorMessage = errorData.detail.error;
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

export async function deleteManagedUser(userId: number, token: string): Promise<void> {
    const res = await fetch(`${API_URL}/users/${userId}`, {
        method: "DELETE",
        headers: {
            "Authorization": `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.detail || errorData.message || "Failed to revoke user");
    }
}

export async function promoteManagedUser(userId: number, token: string): Promise<ManagedUser> {
    const res = await fetch(`${API_URL}/users/${userId}/promote`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.detail || "Failed to promote user");
    }

    return res.json();
}

export async function fetchMyProfile() {
    const token = getToken();
    if (!token) {
        throw new Error("No token available");
    }

    const res = await fetch(`${API_URL}/users/me`, {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    if (!res.ok) {
        if (res.status === 401) {
            removeToken();
        }
        throw new Error("Failed to fetch profile");
    }

    return res.json();
}

export async function fetchSystemStatus() {
    const res = await fetch(`${API_URL}/system/status`);
    if (!res.ok) {
        throw new Error("Failed to check system status");
    }
    return res.json();
}
