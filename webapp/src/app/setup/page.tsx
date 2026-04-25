/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { initializeServer, fetchSystemStatus } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastContext";
import { useLanguage, LanguageCode } from "@/components/LanguageContext";
import { HomeLocation } from "@/lib/home-location";
import HomeLocationPicker from "@/components/HomeLocationPicker";

type SetupStep = 1 | 2;

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export default function SetupPage() {
    const { language, setLanguage, t } = useLanguage();
    const [step, setStep] = useState<SetupStep>(1);
    const [username, setUsername] = useState("");
    const [fullname, setFullname] = useState("");
    const [householdName, setHouseholdName] = useState("");
    const [password, setPassword] = useState("");
    const [repassword, setRepassword] = useState("");
    const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);

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
                                }, 700);
                            }
                        }, 4300);
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

    const validateAdminStep = () => {
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
        } else if (password.length < 8) {
            newFieldErrors.password = "Password must be at least 8 characters.";
            isValid = false;
        }
        if (password !== repassword) {
            newFieldErrors.repassword = "Passwords do not match.";
            isValid = false;
        }

        setFieldErrors(newFieldErrors);
        return isValid;
    };

    const clearFieldError = (field: string) => {
        setFieldErrors((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
    };

    const applyHomeLocation = useCallback((location: HomeLocation) => {
        setHomeLocation(location);
        setError("");
        setFieldErrors((prev) => {
            const next = { ...prev };
            delete next.homeLocation;
            return next;
        });
    }, []);

    const handleAdminContinue = (event: FormEvent) => {
        event.preventDefault();
        setError("");
        if (validateAdminStep()) {
            setStep(2);
        }
    };

    const handleSubmit = async () => {
        setError("");

        if (!validateAdminStep()) {
            setStep(1);
            return;
        }

        if (!homeLocation) {
            setFieldErrors((prev) => ({ ...prev, homeLocation: "Choose the home location for this server." }));
            return;
        }

        setIsLoading(true);

        try {
            await initializeServer({
                username,
                password,
                fullname,
                householdName,
                language,
                home_location: {
                    latitude: homeLocation.latitude,
                    longitude: homeLocation.longitude,
                    label: homeLocation.label,
                    source: homeLocation.source,
                },
            });
            showToast("Server initialized successfully! Redirecting to login...", "success");
            setTimeout(() => {
                window.location.href = "/login";
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
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t("error.connection")}</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{statusError}</p>
                    <button onClick={() => window.location.reload()} className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm hover:shadow">
                        {t("error.retry")}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            {showSplash && (
                <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white dark:bg-slate-950 transition-all duration-700 ease-in-out ${
                    splashAnimating ? "opacity-0 scale-110 pointer-events-none" : "opacity-100 scale-100"
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
                            style={{ fontSize: "140px", lineHeight: "1" }}
                        >
                            hub
                        </span>
                        <div className="flex flex-col items-end">
                            <h1 className="text-slate-900 dark:text-white text-6xl sm:text-[96px] font-extrabold tracking-tight leading-none animate-text-slide" style={{ marginTop: "10px" }}>
                                E-Connect
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm sm:text-base font-semibold tracking-widest uppercase animate-typing-text">
                                Connect All Your Things
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="min-h-screen bg-slate-50 dark:bg-[#090e17] flex items-center justify-center p-4 relative overflow-hidden">
                {/* Decorative background glows */}
                <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/20 dark:bg-primary/15 rounded-full blur-[120px] pointer-events-none mix-blend-screen dark:mix-blend-lighten"></div>
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/15 dark:bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen dark:mix-blend-lighten"></div>

                <div className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50">
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                        className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-white/40 dark:border-slate-700/50 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm transition-all hover:bg-white/90 dark:hover:bg-slate-800/90 cursor-pointer"
                    >
                        <option value="en">English</option>
                        <option value="vi">Tiếng Việt</option>
                    </select>
                </div>

                <div className="bg-white/70 dark:bg-slate-900/60 backdrop-blur-2xl border border-white/50 dark:border-slate-700/50 rounded-[2rem] p-8 sm:p-12 w-full max-w-4xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] flex flex-col relative z-10 mx-auto">
                    
                    <div className="w-full flex flex-col justify-center">
                        <div className="mb-10 flex items-center justify-between text-xs font-bold tracking-wider">
                            <div className="flex items-center gap-3">
                                <span className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-500 ${step === 1 ? "bg-gradient-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/30" : "bg-emerald-500/15 text-emerald-500"}`}>{step > 1 ? <span className="material-icons-round text-[18px]">check</span> : "1"}</span>
                                <span className={`hidden sm:block ${step === 1 ? "text-slate-900 dark:text-white" : "text-slate-500"}`}>{t("setup.step1.title")}</span>
                            </div>
                            <div className="h-0.5 flex-1 bg-gradient-to-r from-slate-200 to-slate-100 dark:from-slate-700/50 dark:to-slate-800/50 rounded-full overflow-hidden mx-4">
                                <div className={`h-full bg-primary transition-all duration-700 ${step > 1 ? "w-full" : "w-0"}`}></div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className={`hidden sm:block ${step === 2 ? "text-slate-900 dark:text-white" : "text-slate-500"}`}>{t("setup.step2.title")}</span>
                                <span className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-500 delay-100 ${step === 2 ? "bg-gradient-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/30" : "bg-slate-100 dark:bg-slate-800 text-slate-400"}`}>2</span>
                            </div>
                        </div>

                        <div className="mb-10 flex flex-col items-center text-center">
                            <div className="w-16 h-16 bg-gradient-to-tr from-primary/20 to-primary/5 dark:from-primary/30 dark:to-primary/5 border border-primary/20 rounded-2xl flex items-center justify-center mb-6 relative shadow-inner">
                                <span className="material-icons-round text-primary text-3xl relative z-10 drop-shadow-md">{step === 1 ? "admin_panel_settings" : "home_pin"}</span>
                            </div>
                            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-3 tracking-tight">{step === 1 ? t("setup.step1.title") : t("setup.step2.title")}</h1>
                            <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-lg">{step === 1 ? t("setup.step1.description") : t("setup.step2.description")}</p>
                        </div>

                        {error && (
                            <div className="w-full bg-red-500/10 border border-red-500/50 text-red-500 text-sm rounded-lg p-3 mb-6 flex items-center">
                                <span className="material-icons-round mr-2 text-[18px]">error_outline</span>
                                {error}
                            </div>
                        )}

                        {step === 1 ? (
                            <form onSubmit={handleAdminContinue} noValidate className="w-full space-y-6">
                                <div className="group">
                                    <label className={`block text-xs font-bold mb-2 uppercase tracking-wider transition-colors ${fieldErrors.householdName ? "text-red-500" : "text-slate-600 dark:text-slate-400 group-focus-within:text-primary"}`}>{t("setup.form.household_name")}</label>
                                    <div className="relative flex items-center">
                                        <div className={`absolute left-0 pl-4 flex items-center pointer-events-none transition-colors ${fieldErrors.householdName ? "text-red-500" : "text-slate-400 group-focus-within:text-primary"}`}>
                                            <span className="material-icons-round text-xl">home_work</span>
                                        </div>
                                        <input
                                            type="text"
                                            value={householdName}
                                            onChange={(e) => {
                                                setHouseholdName(e.target.value);
                                                clearFieldError("householdName");
                                            }}
                                            className={`w-full bg-slate-50/50 dark:bg-slate-900/50 border rounded-xl py-3 pl-12 pr-4 text-base text-slate-900 dark:text-white placeholder-slate-400/70 focus:outline-none focus:ring-4 focus:border-transparent transition-all duration-300 shadow-sm ${fieldErrors.householdName ? "border-red-500/50 focus:ring-red-500/20" : "border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 focus:ring-primary/20 focus:border-primary"}`}
                                            placeholder={t("setup.form.household_name.placeholder")}
                                        />
                                    </div>
                                    {fieldErrors.householdName && <p className="text-red-500 text-xs mt-2 flex items-center font-medium animate-fade-in"><span className="material-icons-round text-[16px] mr-1.5">error</span>{fieldErrors.householdName}</p>}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="group">
                                        <label className={`block text-xs font-bold mb-2 uppercase tracking-wider transition-colors ${fieldErrors.fullname ? "text-red-500" : "text-slate-600 dark:text-slate-400 group-focus-within:text-primary"}`}>{t("setup.form.fullname")}</label>
                                        <div className="relative flex items-center">
                                            <div className={`absolute left-0 pl-4 flex items-center pointer-events-none transition-colors ${fieldErrors.fullname ? "text-red-500" : "text-slate-400 group-focus-within:text-primary"}`}>
                                                <span className="material-icons-round text-xl">badge</span>
                                            </div>
                                            <input
                                                type="text"
                                                value={fullname}
                                                onChange={(e) => {
                                                    setFullname(e.target.value);
                                                    clearFieldError("fullname");
                                                }}
                                                className={`w-full bg-slate-50/50 dark:bg-slate-900/50 border rounded-xl py-3 pl-12 pr-4 text-base text-slate-900 dark:text-white placeholder-slate-400/70 focus:outline-none focus:ring-4 focus:border-transparent transition-all duration-300 shadow-sm ${fieldErrors.fullname ? "border-red-500/50 focus:ring-red-500/20" : "border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 focus:ring-primary/20 focus:border-primary"}`}
                                                placeholder={t("setup.form.fullname.placeholder")}
                                            />
                                        </div>
                                        {fieldErrors.fullname && <p className="text-red-500 text-xs mt-2 flex items-center font-medium animate-fade-in"><span className="material-icons-round text-[16px] mr-1.5">error</span>{fieldErrors.fullname}</p>}
                                    </div>

                                    <div className="group">
                                        <label className={`block text-xs font-bold mb-2 uppercase tracking-wider transition-colors ${fieldErrors.username ? "text-red-500" : "text-slate-600 dark:text-slate-400 group-focus-within:text-primary"}`}>{t("setup.form.username")}</label>
                                        <div className="relative flex items-center">
                                            <div className={`absolute left-0 pl-4 flex items-center pointer-events-none transition-colors ${fieldErrors.username ? "text-red-500" : "text-slate-400 group-focus-within:text-primary"}`}>
                                                <span className="material-icons-round text-xl">account_circle</span>
                                            </div>
                                            <input
                                                type="text"
                                                value={username}
                                                onChange={(e) => {
                                                    setUsername(e.target.value);
                                                    clearFieldError("username");
                                                }}
                                                className={`w-full bg-slate-50/50 dark:bg-slate-900/50 border rounded-xl py-3 pl-12 pr-4 text-base text-slate-900 dark:text-white placeholder-slate-400/70 focus:outline-none focus:ring-4 focus:border-transparent transition-all duration-300 shadow-sm ${fieldErrors.username ? "border-red-500/50 focus:ring-red-500/20" : "border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 focus:ring-primary/20 focus:border-primary"}`}
                                                placeholder={t("setup.form.username.placeholder")}
                                            />
                                        </div>
                                        {fieldErrors.username && <p className="text-red-500 text-xs mt-2 flex items-center font-medium animate-fade-in"><span className="material-icons-round text-[16px] mr-1.5">error</span>{fieldErrors.username}</p>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="group">
                                        <label className={`block text-xs font-bold mb-2 uppercase tracking-wider transition-colors ${fieldErrors.password ? "text-red-500" : (password.length >= 8 ? "text-emerald-500 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400 group-focus-within:text-primary")}`}>{t("setup.form.password")}</label>
                                        <div className="relative flex items-center">
                                            <div className={`absolute left-0 pl-4 flex items-center pointer-events-none transition-colors ${fieldErrors.password ? "text-red-500" : (password.length >= 8 ? "text-emerald-500" : "text-slate-400 group-focus-within:text-primary")}`}>
                                                <span className="material-icons-round text-xl">{password.length >= 8 ? "verified_user" : "lock_outline"}</span>
                                            </div>
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setPassword(value);
                                                    if (value.length > 0 && value.length < 8) {
                                                        setFieldErrors((prev) => ({ ...prev, password: "Password must be at least 8 characters." }));
                                                    } else {
                                                        clearFieldError("password");
                                                    }
                                                    if (repassword.length > 0 && value !== repassword) {
                                                        setFieldErrors((prev) => ({ ...prev, repassword: "Passwords do not match." }));
                                                    } else if (repassword.length > 0) {
                                                        clearFieldError("repassword");
                                                    }
                                                }}
                                                className={`w-full bg-slate-50/50 dark:bg-slate-900/50 border rounded-xl py-3 pl-12 pr-4 text-base text-slate-900 dark:text-white placeholder-slate-400/70 focus:outline-none focus:ring-4 focus:border-transparent transition-all duration-300 shadow-sm ${fieldErrors.password ? "border-red-500/50 focus:ring-red-500/20" : (password.length >= 8 ? "border-emerald-500/50 focus:ring-emerald-500/20 focus:border-emerald-500" : "border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 focus:ring-primary/20 focus:border-primary")}`}
                                                placeholder="••••••••"
                                            />
                                        </div>
                                        {fieldErrors.password && <p className="text-red-500 text-xs mt-2 flex items-center font-medium animate-fade-in"><span className="material-icons-round text-[16px] mr-1.5">error</span>{fieldErrors.password}</p>}
                                    </div>

                                    <div className="group">
                                        <label className={`block text-xs font-bold mb-2 uppercase tracking-wider transition-colors ${fieldErrors.repassword ? "text-red-500" : (repassword && password === repassword ? "text-emerald-500 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400 group-focus-within:text-primary")}`}>{t("setup.form.repassword")}</label>
                                        <div className="relative flex items-center">
                                            <div className={`absolute left-0 pl-4 flex items-center pointer-events-none transition-colors ${fieldErrors.repassword ? "text-red-500" : (repassword && password === repassword ? "text-emerald-500" : "text-slate-400 group-focus-within:text-primary")}`}>
                                                <span className="material-icons-round text-xl">{repassword && password === repassword ? "verified" : "password"}</span>
                                            </div>
                                            <input
                                                type="password"
                                                value={repassword}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setRepassword(value);
                                                    if (value.length > 0 && password !== value) {
                                                        setFieldErrors((prev) => ({ ...prev, repassword: "Passwords do not match." }));
                                                    } else {
                                                        clearFieldError("repassword");
                                                    }
                                                }}
                                                className={`w-full bg-slate-50/50 dark:bg-slate-900/50 border rounded-xl py-3 pl-12 pr-4 text-base text-slate-900 dark:text-white placeholder-slate-400/70 focus:outline-none focus:ring-4 focus:border-transparent transition-all duration-300 shadow-sm ${fieldErrors.repassword ? "border-red-500/50 focus:ring-red-500/20" : (repassword && password === repassword ? "border-emerald-500/50 focus:ring-emerald-500/20 focus:border-emerald-500" : "border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600 focus:ring-primary/20 focus:border-primary")}`}
                                                placeholder="••••••••"
                                            />
                                        </div>
                                        {fieldErrors.repassword && <p className="text-red-500 text-xs mt-2 flex items-center font-medium animate-fade-in"><span className="material-icons-round text-[16px] mr-1.5">error</span>{fieldErrors.repassword}</p>}
                                    </div>
                                </div>

                                <div className="pt-4">
                                    <button
                                        type="submit"
                                        className="w-full lg:w-auto ml-auto bg-gradient-to-r from-primary to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold px-8 py-3 rounded-xl transition-all duration-300 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.5)] hover:shadow-[0_12px_25px_-6px_rgba(59,130,246,0.7)] hover:-translate-y-0.5 flex justify-center items-center text-sm"
                                    >
                                        {t("setup.form.continue")}
                                        <span className="material-icons-round text-xl ml-2 transition-transform group-hover:translate-x-1">arrow_forward</span>
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <HomeLocationPicker
                                isOpen={step === 2}
                                selectedLocation={homeLocation}
                                onLocationChange={applyHomeLocation}
                                title={t("setup.step2.title")}
                                description={t("setup.step2.description")}
                                isSaving={isLoading}
                                labels={{
                                    useDevice: t("setup.location.use_device"),
                                    requestingLocation: t("setup.location.locating"),
                                    searchLabel: t("setup.location.search_label"),
                                    searchPlaceholder: t("setup.location.search_placeholder"),
                                    searchAriaLabel: t("setup.location.search"),
                                    noneSelected: t("setup.location.none_selected"),
                                    noneDescription: t("setup.location.none_description"),
                                }}
                                actions={
                                    <>
                                        <div className="flex flex-col sm:flex-row gap-4 pt-4">
                                            <button
                                                type="button"
                                                onClick={() => setStep(1)}
                                                className="sm:flex-1 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold py-3 rounded-xl transition-all duration-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-600 flex justify-center items-center text-sm"
                                            >
                                                <span className="material-icons-round text-xl mr-2">arrow_back</span>
                                                {t("setup.form.back")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSubmit}
                                                disabled={isLoading || !homeLocation}
                                                className="sm:flex-[2] bg-gradient-to-r from-primary to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-3 rounded-xl transition-all duration-300 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.5)] hover:shadow-[0_12px_25px_-6px_rgba(59,130,246,0.7)] hover:-translate-y-0.5 flex justify-center items-center disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_20px_-6px_rgba(59,130,246,0.5)] text-sm"
                                            >
                                                {isLoading ? (
                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                ) : (
                                                    <>
                                                        <span className="material-icons-round text-xl mr-2">rocket_launch</span>
                                                        {t("setup.form.submit")}
                                                    </>
                                                )}
                                            </button>
                                        </div>

                                        <p className="text-slate-500 dark:text-slate-400 text-[10px] text-center leading-relaxed">
                                            {t("setup.form.agreement")}
                                        </p>
                                    </>
                                }
                            />
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
