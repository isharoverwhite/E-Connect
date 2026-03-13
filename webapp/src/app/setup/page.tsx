"use client";

import { useState, useEffect } from "react";
import { initializeServer, fetchSystemStatus } from "@/lib/auth";
import { useRouter } from "next/navigation";

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export default function SetupPage() {
    const [username, setUsername] = useState("");
    const [fullname, setFullname] = useState("");
    const [householdName, setHouseholdName] = useState("");
    const [password, setPassword] = useState("");

    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(true);
    const [statusError, setStatusError] = useState("");

    const router = useRouter();

    useEffect(() => {
        let mounted = true;
        const checkStatus = async () => {
            try {
                const sysStatus = await fetchSystemStatus();
                if (mounted) {
                    if (sysStatus.initialized) {
                        router.push("/login");
                    } else {
                        setIsCheckingStatus(false);
                    }
                }
            } catch (error: unknown) {
                if (mounted) {
                    setStatusError(getErrorMessage(error, "Failed to connect to the backend server."));
                    setIsCheckingStatus(false);
                }
            }
        };
        checkStatus();
        return () => { mounted = false; };
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            await initializeServer({
                username,
                password,
                fullname,
                householdName: householdName,
                ui_layout: {}
            });
            // Success, send them to login
            router.push("/login");
        } catch (error: unknown) {
            setError(getErrorMessage(error, "Failed to initialize server"));
        } finally {
            setIsLoading(false);
        }
    };

    if (isCheckingStatus) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (statusError) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4">
                <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-8 max-w-sm text-center shadow-xl">
                    <span className="material-icons-round text-red-500 text-5xl mb-4">cloud_off</span>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Connection Error</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{statusError}</p>
                    <button onClick={() => window.location.reload()} className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm hover:shadow">
                        Retry Connection
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4">
            <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-8 w-full max-w-lg shadow-xl flex items-start space-x-8">

                {/* Visual Side Info */}
                <div className="flex-1 hidden sm:flex flex-col items-center justify-center border-r border-slate-200 dark:border-slate-700 pr-8">
                    <div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center mb-6 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-20"></span>
                        <span className="material-icons-round text-blue-500 text-5xl relative z-10">dns</span>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2 text-center">First Time Setup</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-xs text-center leading-relaxed">
                        Your E-Connect server is currently uninitialized. Please create the Master Administrator account to secure this node.
                    </p>
                </div>

                {/* Form */}
                <div className="flex-1 w-full">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 sm:hidden">Create Administrator Account</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-xs mb-6 sm:hidden">This is a one-time setup. This account will have full administrative privileges.</p>

                    {error && (
                        <div className="w-full bg-red-500/10 border border-red-500/50 text-red-500 text-sm rounded-lg p-3 mb-6 flex items-center">
                            <span className="material-icons-round mr-2 text-[18px]">error_outline</span>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="w-full space-y-4">

                        {/* Fullname */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">Full Name</label>
                            <div className="relative">
                                <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[18px]">badge</span>
                                <input
                                    type="text"
                                    value={fullname}
                                    onChange={(e) => setFullname(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                    placeholder="Jane Doe"
                                    required
                                />
                            </div>
                        </div>

                        {/* Username */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">Admin Username</label>
                            <div className="relative">
                                <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[18px]">admin_panel_settings</span>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                    placeholder="admin"
                                    required
                                />
                            </div>
                        </div>

                        {/* Household Name */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">Household Name</label>
                            <div className="relative">
                                <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[18px]">home</span>
                                <input
                                    type="text"
                                    value={householdName}
                                    onChange={(e) => setHouseholdName(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                    placeholder="My Smart Home"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <div className="flex justify-between items-center mb-1.5">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Secure Password</label>
                            </div>
                            <div className="relative">
                                <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[18px]">lock</span>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                    placeholder="••••••••"
                                    required
                                    minLength={8}
                                />
                            </div>
                        </div>

                        <div className="mt-6">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-primary hover:bg-blue-600 text-white font-medium py-2.5 rounded-lg transition shadow-sm hover:shadow flex justify-center items-center disabled:opacity-70 text-sm mb-3"
                            >
                                {isLoading ? (
                                    <span className="material-icons-round animate-spin">refresh</span>
                                ) : (
                                    "Initialize Server"
                                )}
                            </button>
                            <p className="text-slate-500 dark:text-slate-400 text-[10px] text-center leading-relaxed">
                                By clicking Initialize, you agree to become the super administrator for this instance. Please ensure you store your credentials securely.
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
