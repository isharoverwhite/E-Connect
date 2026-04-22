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
                ui_layout: {},
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

            <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4 relative">
                <div className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50">
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                        className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm transition"
                    >
                        <option value="en">English</option>
                        <option value="vi">Tiếng Việt</option>
                    </select>
                </div>

                <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-6 sm:p-8 w-full max-w-5xl shadow-xl grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 sm:gap-8">
                    <div className="hidden lg:flex flex-col justify-between border-r border-slate-200 dark:border-slate-700 pr-8">
                        <div>
                            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-20"></span>
                                <span className="material-icons-round text-primary text-4xl relative z-10">{step === 1 ? "admin_panel_settings" : "home_pin"}</span>
                            </div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t("setup.title")}</h2>
                            <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">
                                {step === 1 ? t("setup.step1.description") : t("setup.step2.description")}
                            </p>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className={`flex items-center gap-3 ${step === 1 ? "text-primary" : "text-emerald-500"}`}>
                                <span className="material-icons-round text-lg">{step === 1 ? "radio_button_checked" : "check_circle"}</span>
                                <span className="font-semibold">{t("setup.step1.title")}</span>
                            </div>
                            <div className={`flex items-center gap-3 ${step === 2 ? "text-primary" : "text-slate-400"}`}>
                                <span className="material-icons-round text-lg">{step === 2 ? "radio_button_checked" : "radio_button_unchecked"}</span>
                                <span className="font-semibold">{t("setup.step2.title")}</span>
                            </div>
                        </div>
                    </div>

                    <div className="w-full">
                        <div className="mb-6 lg:hidden">
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{step === 1 ? t("setup.step1.title") : t("setup.step2.title")}</h1>
                            <p className="text-slate-500 dark:text-slate-400 text-xs">{step === 1 ? t("setup.step1.description") : t("setup.step2.description")}</p>
                        </div>

                        <div className="mb-6 flex items-center gap-3 text-xs font-semibold">
                            <span className={`px-3 py-1 rounded-full ${step === 1 ? "bg-primary text-white" : "bg-emerald-500/10 text-emerald-500"}`}>1</span>
                            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700"></div>
                            <span className={`px-3 py-1 rounded-full ${step === 2 ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}>2</span>
                        </div>

                        {error && (
                            <div className="w-full bg-red-500/10 border border-red-500/50 text-red-500 text-sm rounded-lg p-3 mb-6 flex items-center">
                                <span className="material-icons-round mr-2 text-[18px]">error_outline</span>
                                {error}
                            </div>
                        )}

                        {step === 1 ? (
                            <form onSubmit={handleAdminContinue} noValidate className="w-full space-y-4">
                                <div>
                                    <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.householdName ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>{t("setup.form.household_name")}</label>
                                    <div className="relative">
                                        <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] ${fieldErrors.householdName ? "text-red-500" : "text-slate-400"}`}>home</span>
                                        <input
                                            type="text"
                                            value={householdName}
                                            onChange={(e) => {
                                                setHouseholdName(e.target.value);
                                                clearFieldError("householdName");
                                            }}
                                            className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.householdName ? "border-red-500 focus:ring-red-500" : "border-slate-300 dark:border-slate-700 focus:ring-primary"}`}
                                            placeholder={t("setup.form.household_name.placeholder")}
                                        />
                                    </div>
                                    {fieldErrors.householdName && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.householdName}</p>}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.fullname ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>{t("setup.form.fullname")}</label>
                                        <div className="relative">
                                            <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] ${fieldErrors.fullname ? "text-red-500" : "text-slate-400"}`}>badge</span>
                                            <input
                                                type="text"
                                                value={fullname}
                                                onChange={(e) => {
                                                    setFullname(e.target.value);
                                                    clearFieldError("fullname");
                                                }}
                                                className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.fullname ? "border-red-500 focus:ring-red-500" : "border-slate-300 dark:border-slate-700 focus:ring-primary"}`}
                                                placeholder={t("setup.form.fullname.placeholder")}
                                            />
                                        </div>
                                        {fieldErrors.fullname && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.fullname}</p>}
                                    </div>

                                    <div>
                                        <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.username ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>{t("setup.form.username")}</label>
                                        <div className="relative">
                                            <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] ${fieldErrors.username ? "text-red-500" : "text-slate-400"}`}>admin_panel_settings</span>
                                            <input
                                                type="text"
                                                value={username}
                                                onChange={(e) => {
                                                    setUsername(e.target.value);
                                                    clearFieldError("username");
                                                }}
                                                className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.username ? "border-red-500 focus:ring-red-500" : "border-slate-300 dark:border-slate-700 focus:ring-primary"}`}
                                                placeholder={t("setup.form.username.placeholder")}
                                            />
                                        </div>
                                        {fieldErrors.username && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.username}</p>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.password ? "text-red-500" : (password.length >= 8 ? "text-emerald-500 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300")}`}>{t("setup.form.password")}</label>
                                        <div className="relative">
                                            <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] transition-colors ${fieldErrors.password ? "text-red-500" : (password.length >= 8 ? "text-emerald-500" : "text-slate-400")}`}>
                                                {password.length >= 8 ? "check_circle" : "lock"}
                                            </span>
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
                                                className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.password ? "border-red-500 focus:ring-red-500" : (password.length >= 8 ? "border-emerald-500 focus:ring-emerald-500" : "border-slate-300 dark:border-slate-700 focus:ring-primary")}`}
                                                placeholder="••••••••"
                                            />
                                        </div>
                                        {fieldErrors.password && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.password}</p>}
                                    </div>

                                    <div>
                                        <label className={`block text-xs font-semibold mb-1.5 uppercase tracking-wide ${fieldErrors.repassword ? "text-red-500" : (repassword && password === repassword ? "text-emerald-500 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300")}`}>{t("setup.form.repassword")}</label>
                                        <div className="relative">
                                            <span className={`material-icons-round absolute left-3 top-2.5 text-[18px] transition-colors ${fieldErrors.repassword ? "text-red-500" : (repassword && password === repassword ? "text-emerald-500" : "text-slate-400")}`}>
                                                {repassword && password === repassword ? "check_circle" : "lock"}
                                            </span>
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
                                                className={`w-full bg-slate-50 dark:bg-black/20 border rounded-lg py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${fieldErrors.repassword ? "border-red-500 focus:ring-red-500" : (repassword && password === repassword ? "border-emerald-500 focus:ring-emerald-500" : "border-slate-300 dark:border-slate-700 focus:ring-primary")}`}
                                                placeholder="••••••••"
                                            />
                                        </div>
                                        {fieldErrors.repassword && <p className="text-red-500 text-xs mt-1.5 flex items-center font-medium"><span className="material-icons-round text-[14px] mr-1">error</span>{fieldErrors.repassword}</p>}
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        className="w-full sm:w-auto bg-primary hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-lg transition shadow-sm hover:shadow flex justify-center items-center text-sm"
                                    >
                                        {t("setup.form.continue")}
                                        <span className="material-icons-round text-lg ml-2">arrow_forward</span>
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
                                        <div className="flex flex-col sm:flex-row gap-3 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setStep(1)}
                                                className="sm:flex-1 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium py-2.5 rounded-lg transition hover:bg-slate-50 dark:hover:bg-slate-800 flex justify-center items-center text-sm"
                                            >
                                                <span className="material-icons-round text-lg mr-2">arrow_back</span>
                                                {t("setup.form.back")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSubmit}
                                                disabled={isLoading || !homeLocation}
                                                className="sm:flex-1 bg-primary hover:bg-blue-600 text-white font-medium py-2.5 rounded-lg transition shadow-sm hover:shadow flex justify-center items-center disabled:opacity-70 text-sm"
                                            >
                                                {isLoading ? (
                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                ) : (
                                                    t("setup.form.submit")
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
