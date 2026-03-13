"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getToken, removeToken, fetchMyProfile, fetchSystemStatus } from "@/lib/auth";

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

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    logout: () => { },
    refreshProfile: async () => { },
});

export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    const fetchUser = useCallback(async () => {
        try {
            // Check system status first for new setups
            try {
                const sysStatus = await fetchSystemStatus();
                if (!sysStatus.initialized) {
                    if (pathname !== "/setup") {
                        router.push("/setup");
                    }
                    // Explicitly exit without changing loading yet, letting push happen. OR we can set loading to false but explicitly mark user as 'SETUP_REQUIRED'.
                    // For now, if we set loading to false, the second useEffect will kick in. We need to handle that.
                    setLoading(false);
                    return; // Stop auth flow, system needs initialization
                }
            } catch {
                console.warn("Failed to check system initialized state.");
            }

            const token = getToken();
            if (!token) throw new Error("No token");

            const profile = await fetchMyProfile();
            setUser(profile);
        } catch {
            setUser(null);
            removeToken();
        } finally {
            setLoading(false);
        }
    }, [pathname, router]);

    const logout = () => {
        removeToken();
        setUser(null);
        router.push("/login");
    };

    useEffect(() => {
        void fetchUser();
    }, [fetchUser]);

    useEffect(() => {
        // Route protection
        if (!loading) {
            // Very critical: If we are uninitialized, the first check will push us to /setup, 
            // but we must stop this effect from bouncing us back to /login because user is null.
            const isSetupRoute = pathname === "/setup";

            // If we are on /setup, we allow staying there since fetchUser handles the push if not initialized.
            if (isSetupRoute) {
                // Do not redirect to login if we are supposed to be setting up.
                // Note: Security here assumes /setup protects itself.
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

    // Don't render protected pages until auth is resolved to prevent flashes
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
