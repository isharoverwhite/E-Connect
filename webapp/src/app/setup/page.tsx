/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useState, useEffect } from "react";
import { initializeServer, fetchSystemStatus } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastContext";

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export default function SetupPage() {
    const [username, setUsername] = useState("");
    const [fullname, setFullname] = useState("");
    const [householdName, setHouseholdName] = useState("");
    const [password, setPassword] = useState("");
    const [repassword, setRepassword] = useState("");

    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(true);
    const [statusError, setStatusError] = useState("");

    const [showSplash, setShowSplash] = useState(false);
    const [splashAnimating, setSplashAnimating] = useState(false);

    const router = useRouter();
    const { showToast } = useToast();

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
                        setShowSplash(true);
                        
                        setTimeout(() => {
                            if (mounted) {
                                setSplashAnimating(true);
                                setTimeout(() => {
                                    if (mounted) setShowSplash(false);
                                }, 700); // Wait for transition to complete
                            }
                        }, 4300); // 4.3s + 0.7s transition = 5s total
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
        setFieldErrors({});

        let isValid = true;
        const newFieldErrors: Record<string, string> = {};

        if (!householdName.trim()) {
            newFieldErrors.householdName = "Please provide a household name.";
            isValid = false;
        }
        if (!fullname.trim()) {
            newFieldErrors.fullname = "Please enter your full name.";
            isValid = false;
        }
        if (!username.trim()) {
            newFieldErrors.username = "An admin username is required.";
            isValid = false;
        }
        if (!password) {
            newFieldErrors.password = "A secure password is required.";
            isValid = false;
        } else if (password.length < 6) {
            newFieldErrors.password = "Password must be at least 6 characters.";
            isValid = false;
        }
        if (password !== repassword) {
            newFieldErrors.repassword = "Passwords do not match.";
            isValid = false;
        }

        if (!isValid) {
            setFieldErrors(newFieldErrors);
            return;
        }

        setIsLoading(true);

        try {
            await initializeServer({
                username,
                password,
                fullname,
                householdName,
                ui_layout: {}
            });
            showToast("Server initialized successfully! Redirecting to login...", "success");
            // Success, delay to show toast then send them to login
            setTimeout(() => {
                router.push("/login");
            }, 1000);
        } catch (error: unknown) {
            setError(getErrorMessage(error, "Failed to initialize server"));
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
        <>
            {showSplash && (
                <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white dark:bg-slate-950 transition-all duration-700 ease-in-out ${
                    splashAnimating ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100 scale-100'
                }`}>
                    <style>{`
                        @keyframes wheel-spin {
                            0% { transform: rotate(-1080deg) scale(0); opacity: 0; }
                            100% { transform: rotate(0deg) scale(1); opacity: 1; }
                        }
                        @keyframes text-slide-right {
                            0% { transform: translateX(-50px); opacity: 0; }
                            100% { transform: translateX(0); opacity: 1; }
                        }
                        @keyframes typing-reveal {
                            0% { clip-path: inset(0 100% 0 0); opacity: 1; }
                            100% { clip-path: inset(0 0 0 0); opacity: 1; }
                        }
                        .animate-wheel {
                            animation: wheel-spin 1.2s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
                        }
                        .animate-text-slide {
                            opacity: 0;
                            animation: text-slide-right 0.8s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
                            animation-delay: 0.8s;
                        }
                        .animate-typing-text {
                            opacity: 0;
                            animation: typing-reveal 1.2s steps(23) forwards;
                            animation-delay: 1.5s;
                        }
                    `}</style>
                    <div className="flex items-center justify-center">
                        <span 
                            className="material-icons-round text-primary mr-6 animate-wheel relative z-10 bg-white dark:bg-slate-950"
                            style={{ fontSize: '140px', lineHeight: '1' }}
                        >
                            hub
                        </span>
                        <div className="flex flex-col items-end">
                            <h1 className="text-slate-900 dark:text-white text-6xl sm:text-[96px] font-extrabold tracking-tight leading-none animate-text-slide" style={{ marginTop: '10px' }}>
                                E-Connect
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm sm:text-base font-semibold tracking-widest uppercase animate-typing-text">
                                Connect All Your Things
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4">
                <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-6 sm:p-8 w-full max-w-2xl shadow-xl flex flex-col sm:flex-row sm:items-stretch gap-6 sm:gap-8">

                    {/* Visual Side Info */}
                    <div className="flex-1 hidden sm:flex flex-col items-center justify-center border-r border-slate-200 dark:border-slate-700 pr-8">
                        <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mb-6 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-20"></span>
                            <span className="material-icons-round text-primary text-5xl relative z-10">dns</span>
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

                        <form onSubmit={handleSubmit} noValidate className="w-full space-y-4">

                            {/* Household Name */}
                            <div>
                                <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.householdName ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>Household Name</label>
                                <div className="relative">
                                    <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] ${fieldErrors.householdName ? 'text-red-500' : 'text-slate-400'}`}>home</span>
                                    <input
                                        type="text"
                                        value={householdName}
                                        onChange={(e) => {
                                            setHouseholdName(e.target.value);
                                            if (fieldErrors.householdName) setFieldErrors(prev => ({ ...prev, householdName: "" }));
                                        }}
                                        className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.householdName ? 'border-red-500 focus:ring-red-500' : 'border-slate-300 dark:border-slate-700 focus:ring-primary'}`}
                                        placeholder="My Smart Home"
                                    />
                                </div>
                                {fieldErrors.householdName && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.householdName}</p>}
                            </div>

                            {/* Fullname */}
                            <div>
                                <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.fullname ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>Full Name</label>
                                <div className="relative">
                                    <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] ${fieldErrors.fullname ? 'text-red-500' : 'text-slate-400'}`}>badge</span>
                                    <input
                                        type="text"
                                        value={fullname}
                                        onChange={(e) => {
                                            setFullname(e.target.value);
                                            if (fieldErrors.fullname) setFieldErrors(prev => ({ ...prev, fullname: "" }));
                                        }}
                                        className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.fullname ? 'border-red-500 focus:ring-red-500' : 'border-slate-300 dark:border-slate-700 focus:ring-primary'}`}
                                        placeholder="Jane Doe"
                                    />
                                </div>
                                {fieldErrors.fullname && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.fullname}</p>}
                            </div>

                            {/* Username */}
                            <div>
                                <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.username ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>Admin Username</label>
                                <div className="relative">
                                    <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] ${fieldErrors.username ? 'text-red-500' : 'text-slate-400'}`}>admin_panel_settings</span>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => {
                                            setUsername(e.target.value);
                                            if (fieldErrors.username) setFieldErrors(prev => ({ ...prev, username: "" }));
                                        }}
                                        className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.username ? 'border-red-500 focus:ring-red-500' : 'border-slate-300 dark:border-slate-700 focus:ring-primary'}`}
                                        placeholder="admin"
                                    />
                                </div>
                                {fieldErrors.username && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.username}</p>}
                            </div>

                            {/* Password */}
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className={`block text-xs font-semibold uppercase tracking-wide ${fieldErrors.password ? 'text-red-500' : (password.length >= 6 ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300')}`}>Secure Password</label>
                                </div>
                                <div className="relative">
                                    <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] transition-colors ${fieldErrors.password ? 'text-red-500' : (password.length >= 6 ? 'text-emerald-500' : 'text-slate-400')}`}>
                                        {password.length >= 6 ? 'check_circle' : 'lock'}
                                    </span>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setPassword(val);

                                            // Live check for length
                                            if (val.length > 0 && val.length < 6) {
                                                setFieldErrors(prev => ({ ...prev, password: "Password must be at least 6 characters." }));
                                            } else {
                                                setFieldErrors(prev => {
                                                    const newErrors = { ...prev };
                                                    delete newErrors.password;
                                                    return newErrors;
                                                });
                                            }

                                            // Match check
                                            if (repassword.length > 0) {
                                                if (val !== repassword) {
                                                    setFieldErrors(prev => ({ ...prev, repassword: "Passwords do not match." }));
                                                } else {
                                                    setFieldErrors(prev => {
                                                        const newErrors = { ...prev };
                                                        delete newErrors.repassword;
                                                        return newErrors;
                                                    });
                                                }
                                            }
                                        }}
                                        className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.password ? 'border-red-500 focus:ring-red-500' : (password.length >= 6 ? 'border-emerald-500 focus:ring-emerald-500' : 'border-slate-300 dark:border-slate-700 focus:ring-primary')}`}
                                        placeholder="••••••••"
                                    />
                                </div>
                                {fieldErrors.password && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.password}</p>}
                            </div>

                            {/* Re-enter Password */}
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className={`block text-xs font-semibold uppercase tracking-wide ${fieldErrors.repassword ? 'text-red-500' : (repassword && password === repassword ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300')}`}>Re-Enter Password</label>
                                </div>
                                <div className="relative">
                                    <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] transition-colors ${fieldErrors.repassword ? 'text-red-500' : (repassword && password === repassword ? 'text-emerald-500' : 'text-slate-400')}`}>
                                        {repassword && password === repassword ? 'check_circle' : 'lock'}
                                    </span>
                                    <input
                                        type="password"
                                        value={repassword}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setRepassword(val);
                                            if (val.length > 0) {
                                                if (password !== val) {
                                                    setFieldErrors(prev => ({ ...prev, repassword: "Passwords do not match." }));
                                                } else {
                                                    setFieldErrors(prev => {
                                                        const newErrors = { ...prev };
                                                        delete newErrors.repassword;
                                                        return newErrors;
                                                    });
                                                }
                                            } else {
                                                setFieldErrors(prev => {
                                                    const newErrors = { ...prev };
                                                    delete newErrors.repassword;
                                                    return newErrors;
                                                });
                                            }
                                        }}
                                        className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.repassword ? 'border-red-500 focus:ring-red-500' : (repassword && password === repassword ? 'border-emerald-500 focus:ring-emerald-500' : 'border-slate-300 dark:border-slate-700 focus:ring-primary')}`}
                                        placeholder="••••••••"
                                    />
                                </div>
                                {fieldErrors.repassword && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.repassword}</p>}
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
        </>
    );
}

