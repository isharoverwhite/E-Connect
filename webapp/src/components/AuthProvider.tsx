/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

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
    ServerOfflineError,
    type AuthSession,
} from "@/lib/auth";

interface User {
    user_id: number;
    username: string;
    fullname: string;
    account_type: string;
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
const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

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
    const [serverOffline, setServerOffline] = useState(false);
    const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
    const router = useRouter();
    const pathname = usePathname();
    const sessionTimeoutRef = useRef<number | null>(null);
    const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
    const lastRefreshAtRef = useRef(0);
    const fetchUserRunIdRef = useRef(0);
    const pathnameRef = useRef(pathname);

    useEffect(() => {
        pathnameRef.current = pathname;
    }, [pathname]);

    const clearSessionTimeout = useCallback(() => {
        if (sessionTimeoutRef.current !== null) {
            window.clearTimeout(sessionTimeoutRef.current);
            sessionTimeoutRef.current = null;
        }
    }, []);

    const logout = useCallback(() => {
        fetchUserRunIdRef.current += 1;
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

        const effectiveDelay = Math.min(delay, MAX_BROWSER_TIMEOUT_MS);
        sessionTimeoutRef.current = window.setTimeout(() => {
            const latestSession = getSession();
            if (!latestSession) {
                logout();
                return;
            }

            scheduleSessionTimeout(latestSession);
        }, effectiveDelay);
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
        const runId = ++fetchUserRunIdRef.current;
        const isCurrentRun = () => fetchUserRunIdRef.current === runId;

        try {
            setServerOffline(false);
            try {
                const sysStatus = await fetchSystemStatus();
                if (!isCurrentRun()) {
                    return;
                }
                
                setIsInitialized(sysStatus.initialized);

                if (!sysStatus.initialized) {
                    if (pathnameRef.current !== "/setup") {
                        router.push("/setup");
                    }
                    return;
                }
            } catch (err: unknown) {
                if (!isCurrentRun()) {
                    return;
                }

                if (err instanceof TypeError || err instanceof ServerOfflineError) {
                    setServerOffline(true);
                    return;
                }
                console.warn("Failed to check system initialized state.");
            }

            const sessionReady = await ensureActiveSession();
            const token = getToken();
            if (!sessionReady || !token) {
                throw new Error("No token");
            }

            const profile = await fetchMyProfile();
            if (!isCurrentRun()) {
                return;
            }

            setUser(profile);
        } catch (err: unknown) {
            if (!isCurrentRun()) {
                return;
            }

            if (err instanceof TypeError || err instanceof ServerOfflineError) {
                setServerOffline(true);
                return;
            }
            setUser(null);
            removeToken();
            clearSessionTimeout();
        } finally {
            if (isCurrentRun()) {
                setLoading(false);
            }
        }
    }, [clearSessionTimeout, ensureActiveSession, router]);

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
            if (isInitialized === false) {
                if (pathname !== "/setup") {
                    router.push("/setup");
                }
                return;
            }

            const isSetupRoute = pathname === "/setup";
            if (isSetupRoute && isInitialized === true) {
                router.push(user ? "/" : "/login");
                return;
            }

            const isAuthRoute = pathname === "/login" || pathname === "/register";
            if (!user && !isAuthRoute) {
                router.push("/login");
            } else if (user && isAuthRoute) {
                router.push("/");
            }
        }
    }, [user, loading, pathname, router, isInitialized]);

    useEffect(() => {
        return () => {
            clearSessionTimeout();
        };
    }, [clearSessionTimeout]);

    if (serverOffline) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4">
                <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-8 max-w-md w-full shadow-xl flex flex-col items-center">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
                        <span className="material-icons-round text-red-500 text-3xl">wifi_off</span>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2 text-center">Cannot find your Logic server</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-8 text-center leading-relaxed">
                        We couldn&apos;t reach your E-Connect backend. It might be turned off, updating, or on a different network. Please ensure both the WebUI and the backend server are actively running on the same host machine, then give it another try.
                    </p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            setServerOffline(false);
                            void fetchUser();
                        }}
                        className="w-full bg-primary hover:bg-blue-600 text-white font-medium py-2.5 rounded-xl transition shadow-sm hover:shadow shadow-primary/20 flex justify-center items-center"
                    >
                        <span className="material-icons-round mr-2 text-lg">refresh</span>
                        Retry Connection
                    </button>
                </div>
            </div>
        );
    }

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
