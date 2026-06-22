/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { initializeServer, fetchSystemStatus } from "@/lib/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ToastContext";
import { useLanguage, LanguageCode } from "@/components/LanguageContext";
import { HomeLocation } from "@/lib/home-location";
import HomeLocationPicker from "@/components/HomeLocationPicker";
import { motion, AnimatePresence } from "framer-motion";

type SetupStep = 1 | 2;
type ScreenState = "splash" | "onboarding" | "setup" | "done" | "error";

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
    const [screenState, setScreenState] = useState<ScreenState>("splash");
    const [statusError, setStatusError] = useState("");

    const [loadingTextIndex, setLoadingTextIndex] = useState(0);
    const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);

    const router = useRouter();
    const { showToast } = useToast();

    const loadingTexts = [
        t("setup.splash.loading_1") || "Waking up server...",
        t("setup.splash.loading_2") || "Checking database...",
        t("setup.splash.loading_3") || "Connecting ecosystem..."
    ];

    const onboardingSlides = [
        { title: t("setup.onboarding.slide1.title") || "Connect Everything", desc: t("setup.onboarding.slide1.desc") || "Discover and pair your DIY or smart home devices instantly.", icon: "devices_other" },
        { title: t("setup.onboarding.slide2.title") || "100% Local & Secure", desc: t("setup.onboarding.slide2.desc") || "Your data stays in your home. No cloud dependency.", icon: "gpp_good" },
        { title: t("setup.onboarding.slide3.title") || "Build Your Ecosystem", desc: t("setup.onboarding.slide3.desc") || "Set up automations and control your house your way.", icon: "auto_awesome" }
    ];

    useEffect(() => {
        if (screenState !== "splash") return;
        const interval = setInterval(() => {
            setLoadingTextIndex(i => (i + 1) % loadingTexts.length);
        }, 1500);
        return () => clearInterval(interval);
    }, [screenState, loadingTexts.length]);

    useEffect(() => {
        let mounted = true;
        const checkStatus = async () => {
            try {
                const startTime = Date.now();
                const sysStatus = await fetchSystemStatus();
                const elapsed = Date.now() - startTime;
                const minWait = 2500;
                if (elapsed < minWait) await new Promise(r => setTimeout(r, minWait - elapsed));

                if (mounted) {
                    if (sysStatus.initialized) {
                        window.location.href = "/login";
                    } else {
                        setScreenState("onboarding");
                    }
                }
            } catch (error: unknown) {
                if (mounted) {
                    setStatusError(getErrorMessage(error, "Failed to connect to the backend server."));
                    setScreenState("error");
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

    const handleSubmit = async (skipLocation = false) => {
        setError("");

        if (!validateAdminStep()) {
            setStep(1);
            return;
        }

        if (!skipLocation && !homeLocation) {
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
                home_location: homeLocation
                    ? {
                          latitude: homeLocation.latitude,
                          longitude: homeLocation.longitude,
                          label: homeLocation.label,
                          source: homeLocation.source,
                      }
                    : undefined,
            });
            showToast("Server initialized successfully!", "success");
            setScreenState("done");
        } catch (error: unknown) {
            setError(getErrorMessage(error, "Failed to initialize server"));
            setIsLoading(false);
        }
    };

    const handleSkipLocation = () => {
        showToast(t("setup.form.skip_location_warning"), "info");
        void handleSubmit(true);
    };

    return (
        <div className="min-h-screen bg-background-light dark:bg-background-dark relative overflow-hidden flex items-center justify-center p-4">
            {/* Animated Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <motion.div 
                    animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/20 dark:bg-primary/15 rounded-full blur-[120px] mix-blend-screen dark:mix-blend-lighten"
                />
                <motion.div 
                    animate={{ scale: [1, 1.2, 1], opacity: [0.15, 0.3, 0.15] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/15 dark:bg-emerald-500/10 rounded-full blur-[100px] mix-blend-screen dark:mix-blend-lighten"
                />
            </div>

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

            <AnimatePresence mode="wait">
                {screenState === "splash" && (
                    <motion.div
                        key="splash"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className="relative z-10 flex flex-col items-center justify-center bg-white/60 dark:bg-slate-900/40 backdrop-blur-3xl border border-white/50 dark:border-slate-700/50 rounded-[2.5rem] p-12 sm:p-20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] mx-auto"
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                            className="w-24 h-24 mb-6 rounded-full bg-gradient-to-tr from-primary/20 to-primary/5 flex items-center justify-center shadow-inner border border-primary/20"
                        >
                            <span className="material-icons-round text-primary text-[60px]">hub</span>
                        </motion.div>
                        
                        <h1 className="text-4xl sm:text-6xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">E-Connect</h1>
                        
                        <div className="h-6 overflow-hidden mt-6 relative w-64 text-center">
                            <AnimatePresence mode="popLayout">
                                <motion.p
                                    key={loadingTextIndex}
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    exit={{ y: -20, opacity: 0 }}
                                    transition={{ duration: 0.4 }}
                                    className="text-primary font-semibold text-sm absolute inset-0 tracking-wide uppercase"
                                >
                                    {loadingTexts[loadingTextIndex]}
                                </motion.p>
                            </AnimatePresence>
                        </div>
                    </motion.div>
                )}

                {screenState === "onboarding" && (
                    <motion.div
                        key="onboarding"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.5 }}
                        className="relative z-10 w-full max-w-lg bg-white/70 dark:bg-slate-900/60 backdrop-blur-2xl border border-white/50 dark:border-slate-700/50 rounded-[2rem] p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] flex flex-col items-center text-center mx-auto"
                    >
                        <div className="w-full relative h-56 mb-8 flex items-center justify-center">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={onboardingStepIndex}
                                    initial={{ opacity: 0, x: 50 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -50 }}
                                    transition={{ duration: 0.3 }}
                                    className="absolute inset-0 flex flex-col items-center justify-center"
                                >
                                    <div className="w-24 h-24 mb-6 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                                        <span className="material-icons-round text-5xl text-primary">{onboardingSlides[onboardingStepIndex].icon}</span>
                                    </div>
                                    <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-3 tracking-tight">{onboardingSlides[onboardingStepIndex].title}</h2>
                                    <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">{onboardingSlides[onboardingStepIndex].desc}</p>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                        
                        <div className="flex gap-2 mb-8">
                            {onboardingSlides.map((_, i) => (
                                <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === onboardingStepIndex ? "w-8 bg-primary" : "w-2 bg-slate-300 dark:bg-slate-700"}`} />
                            ))}
                        </div>

                        <button 
                            onClick={() => {
                                if (onboardingStepIndex < onboardingSlides.length - 1) {
                                    setOnboardingStepIndex(i => i + 1);
                                } else {
                                    setScreenState("setup");
                                }
                            }}
                            className="w-full bg-gradient-to-r from-primary to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold px-8 py-3.5 rounded-xl transition-all duration-300 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.5)] hover:shadow-[0_12px_25px_-6px_rgba(59,130,246,0.7)] hover:-translate-y-0.5 flex justify-center items-center text-sm"
                        >
                            {onboardingStepIndex < onboardingSlides.length - 1 ? t("setup.form.continue") || "Continue" : t("setup.onboarding.start") || "Start Setup"}
                        </button>
                    </motion.div>
                )}

                {screenState === "error" && (
                    <motion.div
                        key="error"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="relative z-10 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-8 max-w-sm text-center shadow-xl mx-auto"
                    >
                        <span className="material-icons-round text-red-500 text-5xl mb-4">cloud_off</span>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t("error.connection")}</h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{statusError}</p>
                        <button onClick={() => window.location.reload()} className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm hover:shadow">
                            {t("error.retry")}
                        </button>
                    </motion.div>
                )}

                {screenState === "done" && (
                    <motion.div
                        key="done"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative z-10 bg-white/70 dark:bg-slate-900/60 backdrop-blur-2xl border border-white/50 dark:border-slate-700/50 rounded-[2rem] p-8 sm:p-12 w-full max-w-lg shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] flex flex-col mx-auto"
                    >
                        <div className="text-center mb-8">
                            <span className="material-icons-round text-5xl text-emerald-400">check_circle</span>
                            <h2 className="text-2xl font-bold mt-3 text-slate-900 dark:text-white">E-Connect is ready!</h2>
                            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
                                Your server is set up. Here are your next steps:
                            </p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <Link href="/devices/discovery" className="flex items-center gap-4 p-4 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors text-white">
                                <span className="material-icons-round text-2xl">devices</span>
                                <div className="flex-1">
                                    <div className="font-semibold">Add your first device</div>
                                    <div className="text-xs text-blue-100 mt-0.5">Pair an ESP32 or smart home device</div>
                                </div>
                                <span className="material-icons-round opacity-60">arrow_forward</span>
                            </Link>
                            <Link href="/settings" className="flex items-center gap-4 p-4 rounded-xl bg-slate-700 hover:bg-slate-600 transition-colors text-slate-200">
                                <span className="material-icons-round text-2xl">wifi</span>
                                <div className="flex-1">
                                    <div className="font-semibold">Save Wi-Fi credentials</div>
                                    <div className="text-xs text-slate-400 mt-0.5">So devices can connect automatically</div>
                                </div>
                                <span className="material-icons-round opacity-60">arrow_forward</span>
                            </Link>
                            <Link href="/automation" className="flex items-center gap-4 p-4 rounded-xl bg-slate-700 hover:bg-slate-600 transition-colors text-slate-200">
                                <span className="material-icons-round text-2xl">smart_toy</span>
                                <div className="flex-1">
                                    <div className="font-semibold">Create an automation</div>
                                    <div className="text-xs text-slate-400 mt-0.5">Control devices automatically with rules</div>
                                </div>
                                <span className="material-icons-round opacity-60">arrow_forward</span>
                            </Link>
                        </div>
                        <button onClick={() => window.location.href = '/login'} className="mt-6 w-full text-center text-sm text-blue-500 hover:text-blue-400 font-medium transition-colors">
                            Skip — go to login
                        </button>
                    </motion.div>
                )}

                {screenState === "setup" && (
                    <motion.div
                        key="setup"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative z-10 bg-white/70 dark:bg-slate-900/60 backdrop-blur-2xl border border-white/50 dark:border-slate-700/50 rounded-[2rem] p-8 sm:p-12 w-full max-w-4xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] flex flex-col mx-auto"
                    >
                    
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
                                                onClick={() => void handleSubmit()}
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

                                        {!homeLocation && (
                                            <div className="pt-2">
                                                <button
                                                    type="button"
                                                    onClick={handleSkipLocation}
                                                    disabled={isLoading}
                                                    className="w-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-medium py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                                                >
                                                    <span className="material-icons-round text-[14px]">skip_next</span>
                                                    {t("setup.form.skip_location")}
                                                </button>
                                                <p className="text-amber-600 dark:text-amber-400 text-[10px] text-center mt-1">
                                                    {t("setup.form.skip_location_warning")}
                                                </p>
                                            </div>
                                        )}

                                        <p className="text-slate-500 dark:text-slate-400 text-[10px] text-center leading-relaxed">
                                            {t("setup.form.agreement")}
                                        </p>
                                    </>
                                }
                            />
                        )}
                    </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
