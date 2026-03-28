"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    fetchMyProfile,
    fetchSystemStatus,
    getSession,
    getToken,
    refreshSession,
    removeToken,
    type AuthSession,
} from "@/lib/auth";

interface User {
    user_id: number;
    username: string;
    fullname: string;
    account_type: string;
    approval_status?: "pending" | "approved" | "revoked";
    ui_layout?: unknown;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    logout: () => void;
    refreshProfile: () => Promise<void>;
}

const NON_PERSISTENT_SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SESSION_REFRESH_COOLDOWN_MS = 60 * 1000;

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    logout: () => {},
    refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function getSessionIssuedAt(session: AuthSession | null): number {
    if (!session || session.keep_login || !session.access_token_expires_at) {
        return 0;
    }

    const expiresAt = Date.parse(session.access_token_expires_at);
    if (!Number.isFinite(expiresAt)) {
        return 0;
    }

    return expiresAt - NON_PERSISTENT_SESSION_TIMEOUT_MS;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();
    const sessionTimeoutRef = useRef<number | null>(null);
    const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
    const lastRefreshAtRef = useRef(0);

    const clearSessionTimeout = useCallback(() => {
        if (sessionTimeoutRef.current !== null) {
            window.clearTimeout(sessionTimeoutRef.current);
            sessionTimeoutRef.current = null;
        }
    }, []);

    const logout = useCallback(() => {
        clearSessionTimeout();
        removeToken();
        setUser(null);
        router.push("/login");
    }, [clearSessionTimeout, router]);

    const scheduleSessionTimeout = useCallback((session: AuthSession | null) => {
        clearSessionTimeout();

        if (!session || session.keep_login || !session.access_token_expires_at) {
            return;
        }

        const expiresAt = Date.parse(session.access_token_expires_at);
        if (!Number.isFinite(expiresAt)) {
            return;
        }

        const delay = expiresAt - Date.now();
        if (delay <= 0) {
            logout();
            return;
        }

        sessionTimeoutRef.current = window.setTimeout(() => {
            logout();
        }, delay);
    }, [clearSessionTimeout, logout]);

    const ensureActiveSession = useCallback(async () => {
        const currentSession = getSession();
        scheduleSessionTimeout(currentSession);

        if (!currentSession) {
            return false;
        }

        lastRefreshAtRef.current = Math.max(lastRefreshAtRef.current, getSessionIssuedAt(currentSession));

        if (currentSession.keep_login || !currentSession.refresh_token) {
            return Boolean(currentSession.access_token);
        }

        const now = Date.now();
        if (now - lastRefreshAtRef.current < SESSION_REFRESH_COOLDOWN_MS) {
            return Boolean(currentSession.access_token);
        }

        if (refreshPromiseRef.current) {
            return refreshPromiseRef.current;
        }

        refreshPromiseRef.current = (async () => {
            const nextSession = await refreshSession();
            if (!nextSession) {
                clearSessionTimeout();
                setUser(null);
                return false;
            }

            lastRefreshAtRef.current = Date.now();
            scheduleSessionTimeout(nextSession);
            return true;
        })().finally(() => {
            refreshPromiseRef.current = null;
        });

        return refreshPromiseRef.current;
    }, [clearSessionTimeout, scheduleSessionTimeout]);

    const fetchUser = useCallback(async () => {
        try {
            try {
                const sysStatus = await fetchSystemStatus();
                if (!sysStatus.initialized) {
                    if (pathname !== "/setup") {
                        router.push("/setup");
                    }
                    setLoading(false);
                    return;
                }
            } catch {
                console.warn("Failed to check system initialized state.");
            }

            const sessionReady = await ensureActiveSession();
            const token = getToken();
            if (!sessionReady || !token) {
                throw new Error("No token");
            }

            const profile = await fetchMyProfile();
            setUser(profile);
            scheduleSessionTimeout(getSession());
        } catch {
            setUser(null);
            removeToken();
            clearSessionTimeout();
        } finally {
            setLoading(false);
        }
    }, [clearSessionTimeout, ensureActiveSession, pathname, router, scheduleSessionTimeout]);

    useEffect(() => {
        void fetchUser();
    }, [fetchUser]);

    useEffect(() => {
        function handleActivity() {
            if (document.visibilityState === "hidden") {
                return;
            }
            void ensureActiveSession();
        }

        window.addEventListener("pointerdown", handleActivity, { passive: true });
        window.addEventListener("keydown", handleActivity);
        window.addEventListener("scroll", handleActivity, { passive: true });
        window.addEventListener("focus", handleActivity);
        document.addEventListener("visibilitychange", handleActivity);

        return () => {
            window.removeEventListener("pointerdown", handleActivity);
            window.removeEventListener("keydown", handleActivity);
            window.removeEventListener("scroll", handleActivity);
            window.removeEventListener("focus", handleActivity);
            document.removeEventListener("visibilitychange", handleActivity);
        };
    }, [ensureActiveSession]);

    useEffect(() => {
        if (!loading) {
            const isSetupRoute = pathname === "/setup";
            if (isSetupRoute) {
                return;
            }

            const isAuthRoute = pathname === "/login" || pathname === "/register";
            if (!user && !isAuthRoute) {
                router.push("/login");
            } else if (user && isAuthRoute) {
                router.push("/");
            }
        }
    }, [user, loading, pathname, router]);

    useEffect(() => {
        return () => {
            clearSessionTimeout();
        };
    }, [clearSessionTimeout]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <AuthContext.Provider value={{ user, loading, logout, refreshProfile: fetchUser }}>
            {children}
        </AuthContext.Provider>
    );
}
