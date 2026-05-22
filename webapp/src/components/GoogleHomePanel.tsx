/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/components/ToastContext";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthProvider";

interface GoogleHomeStatus {
    configured: boolean;
    linked: boolean;
    agent_user_id: string | null;
    linked_at: string | null;
}

interface GoogleHomeConfig {
    client_id: string | null;
    client_secret_masked: string | null;
    project_id: string | null;
    service_account_configured: boolean;
    updated_at: string | null;
}

async function fetchGoogleHomeStatus(token: string): Promise<GoogleHomeStatus> {
    const res = await fetch("/api/v1/google/status", {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to fetch Google Home status");
    return res.json();
}

async function fetchGoogleHomeConfig(token: string): Promise<GoogleHomeConfig> {
    const res = await fetch("/api/v1/google/config", {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to fetch Google Home config");
    return res.json();
}

async function saveGoogleHomeConfig(token: string, data: Record<string, string | boolean>): Promise<GoogleHomeConfig> {
    const res = await fetch("/api/v1/google/config", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to save config");
    return res.json();
}

async function unlinkGoogleHome(token: string): Promise<void> {
    const res = await fetch("/api/v1/google/unlink", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to unlink Google Home");
}

async function requestGoogleSync(token: string): Promise<void> {
    const res = await fetch("/api/v1/google/request-sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to request sync");
}

export function GoogleHomePanel() {
    const { showToast } = useToast();
    const { t } = useLanguage();
    const { user } = useAuth();
    const isAdmin = user?.account_type === "admin";

    const [status, setStatus] = useState<GoogleHomeStatus | null>(null);
    const [config, setConfig] = useState<GoogleHomeConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    // Config form state
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [projectId, setProjectId] = useState("");
    const [serviceAccountJson, setServiceAccountJson] = useState("");
    const [showSaJson, setShowSaJson] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);
    const [configError, setConfigError] = useState("");

    async function load() {
        const token = getToken();
        if (!token) return;
        setLoading(true);
        try {
            const [statusData, configData] = await Promise.all([
                fetchGoogleHomeStatus(token),
                isAdmin ? fetchGoogleHomeConfig(token) : Promise.resolve(null),
            ]);
            setStatus(statusData);
            if (configData) {
                setConfig(configData);
                setClientId(configData.client_id ?? "");
                setProjectId(configData.project_id ?? "");
            }
        } catch {
            /* ignore on first load */
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin]);

    async function handleSaveConfig(e: React.FormEvent) {
        e.preventDefault();
        const token = getToken();
        if (!token) return;
        setConfigSaving(true);
        setConfigError("");
        try {
            const payload: Record<string, string | boolean> = {
                client_id: clientId.trim(),
                project_id: projectId.trim(),
            };
            if (clientSecret.trim() && !clientSecret.includes("•")) {
                payload.client_secret = clientSecret.trim();
            }
            if (serviceAccountJson.trim()) {
                payload.service_account_json = serviceAccountJson.trim();
            }
            const updated = await saveGoogleHomeConfig(token, payload);
            setConfig(updated);
            setClientSecret("");
            setServiceAccountJson("");
            showToast(t("google_home.config_saved"), "success");
            await load();
        } catch {
            setConfigError(t("google_home.config_save_error"));
        } finally {
            setConfigSaving(false);
        }
    }

    async function handleUnlink() {
        const token = getToken();
        if (!token) return;
        setUnlinking(true);
        try {
            await unlinkGoogleHome(token);
            showToast(t("google_home.unlinked"), "success");
            await load();
        } catch {
            showToast(t("google_home.unlink_error"), "error");
        } finally {
            setUnlinking(false);
        }
    }

    async function handleRequestSync() {
        const token = getToken();
        if (!token) return;
        setSyncing(true);
        try {
            await requestGoogleSync(token);
            showToast(t("google_home.sync_requested"), "success");
        } catch {
            showToast(t("google_home.sync_error"), "error");
        } finally {
            setSyncing(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* ── Header card ── */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3 mb-1">
                    <GoogleHomeIcon className="w-7 h-7 flex-shrink-0" />
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                        {t("google_home.title")}
                    </h3>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 ml-10">
                    {t("google_home.description")}
                </p>

                {loading ? (
                    <div className="h-10 w-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                ) : !status?.configured ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                            {t("google_home.not_configured")}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                            {isAdmin
                                ? t("google_home.not_configured_admin_hint")
                                : t("google_home.not_configured_hint")}
                        </p>
                    </div>
                ) : status.linked ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />
                            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                {t("google_home.linked")}
                            </span>
                            {status.linked_at && (
                                <span className="text-xs text-slate-400 ml-1">
                                    {t("google_home.linked_since")}{" "}
                                    {new Date(status.linked_at).toLocaleDateString()}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <button
                                onClick={handleRequestSync}
                                disabled={syncing}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                                <SyncIcon className="w-4 h-4" />
                                {syncing ? t("google_home.syncing") : t("google_home.sync_devices")}
                            </button>
                            <button
                                onClick={handleUnlink}
                                disabled={unlinking}
                                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-900/20"
                            >
                                <UnlinkIcon className="w-4 h-4" />
                                {unlinking ? t("google_home.unlinking") : t("google_home.unlink")}
                            </button>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-800/40 dark:bg-blue-900/10">
                            <p className="text-xs text-blue-700 dark:text-blue-400">
                                {t("google_home.voice_hint")}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                                {t("google_home.not_linked")}
                            </span>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                {t("google_home.how_to_link_title")}
                            </p>
                            <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-none">
                                {[
                                    t("google_home.step1"),
                                    t("google_home.step2"),
                                    t("google_home.step3"),
                                    t("google_home.step4"),
                                ].map((step, i) => (
                                    <li key={i} className="flex gap-2">
                                        <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold dark:bg-indigo-900/40 dark:text-indigo-400">
                                            {i + 1}
                                        </span>
                                        <span>{step}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                )}
            </section>

            {/* ── Admin: Google Cloud credentials ── */}
            {isAdmin && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="material-symbols-outlined text-[20px] text-slate-400">cloud</span>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                            {t("google_home.config_title")}
                        </h3>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 ml-7">
                        {t("google_home.config_description")}
                    </p>

                    {config && (
                        <div className="mb-4 flex flex-wrap gap-3">
                            <ConfigBadge
                                label={t("google_home.config_client_id")}
                                value={config.client_id}
                            />
                            <ConfigBadge
                                label={t("google_home.config_project_id")}
                                value={config.project_id}
                            />
                            <ConfigBadge
                                label={t("google_home.config_service_account")}
                                value={config.service_account_configured ? t("google_home.config_configured") : null}
                            />
                        </div>
                    )}

                    <form onSubmit={handleSaveConfig} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                                label={t("google_home.config_client_id")}
                                hint={t("google_home.config_client_id_hint")}
                            >
                                <input
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    placeholder="e.g. my-action-client-id"
                                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                            </FormField>

                            <FormField
                                label={t("google_home.config_client_secret")}
                                hint={t("google_home.config_client_secret_hint")}
                            >
                                <div className="relative">
                                    <input
                                        type={showSaJson ? "text" : "password"}
                                        value={clientSecret}
                                        onChange={e => setClientSecret(e.target.value)}
                                        placeholder={
                                            config?.client_secret_masked
                                                ? config.client_secret_masked
                                                : t("google_home.config_secret_placeholder")
                                        }
                                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-10 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowSaJson(v => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        tabIndex={-1}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            {showSaJson ? "visibility_off" : "visibility"}
                                        </span>
                                    </button>
                                </div>
                            </FormField>

                            <FormField
                                label={t("google_home.config_project_id")}
                                hint={t("google_home.config_project_id_hint")}
                            >
                                <input
                                    type="text"
                                    value={projectId}
                                    onChange={e => setProjectId(e.target.value)}
                                    placeholder="e.g. my-gcloud-project"
                                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                            </FormField>
                        </div>

                        <FormField
                            label={t("google_home.config_service_account")}
                            hint={t("google_home.config_service_account_hint")}
                        >
                            <textarea
                                rows={6}
                                value={serviceAccountJson}
                                onChange={e => setServiceAccountJson(e.target.value)}
                                placeholder={
                                    config?.service_account_configured
                                        ? t("google_home.config_sa_already_set")
                                        : t("google_home.config_sa_placeholder")
                                }
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-mono text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 resize-y"
                            />
                        </FormField>

                        {configError && (
                            <p className="text-sm text-red-600 dark:text-red-400">{configError}</p>
                        )}

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={configSaving}
                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
                            >
                                {configSaving ? (
                                    <>
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        {t("google_home.config_saving")}
                                    </>
                                ) : (
                                    t("google_home.config_save")
                                )}
                            </button>
                        </div>
                    </form>

                    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                {t("google_home.config_setup_note_title")}
                            </p>
                            <div className="flex gap-2">
                                <a
                                    href="https://github.com/isharoverwhite/E-Connect/blob/main/docs/google-home-setup.en.md"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                >
                                    <BookIcon className="w-3.5 h-3.5" />
                                    {t("google_home.guide_en")}
                                </a>
                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                <a
                                    href="https://github.com/isharoverwhite/E-Connect/blob/main/docs/google-home-setup.vi.md"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                >
                                    <BookIcon className="w-3.5 h-3.5" />
                                    {t("google_home.guide_vi")}
                                </a>
                            </div>
                        </div>
                        <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1 list-disc list-inside">
                            <li>{t("google_home.config_note1")}</li>
                            <li>{t("google_home.config_note2")}</li>
                            <li>{t("google_home.config_note3")}</li>
                        </ul>
                    </div>
                </section>
            )}
        </div>
    );
}

function ConfigBadge({ label, value }: { label: string; value: string | null | undefined }) {
    const configured = Boolean(value);
    return (
        <div className="flex items-center gap-1.5 text-xs">
            <span
                className={`inline-flex h-2 w-2 rounded-full ${configured ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
            />
            <span className="text-slate-500 dark:text-slate-400">{label}:</span>
            <span className={`font-medium ${configured ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500 italic"}`}>
                {configured ? (value!.length > 30 ? value!.slice(0, 28) + "…" : value) : "Not set"}
            </span>
        </div>
    );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {label}
            </label>
            {hint && <p className="text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
            {children}
        </div>
    );
}

function BookIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
    );
}

function GoogleHomeIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 154 155" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <radialGradient id="gh_a" cx="-118.17" cy="280.42" r="1" gradientTransform="matrix(4.2185 35.138 43.765 -5.2543 -11436 6610)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#facd0c" offset="0" />
                    <stop stopColor="#facd0c" stopOpacity="0" offset="1" />
                </radialGradient>
                <radialGradient id="gh_b" cx="-117.19" cy="278.63" r="1" gradientTransform="matrix(20.699 28.705 35.753 -25.781 -7188.5 11567)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#a5ce3d" offset="0" />
                    <stop stopColor="#a5ce3d" stopOpacity="0" offset="1" />
                </radialGradient>
                <linearGradient id="gh_i" x1="118.38" x2="152.38" y1="151.08" y2="144.71" gradientTransform="matrix(.97602 .2177 .2177 -.97602 266.35 1023.8)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#d669a8" offset="0" />
                    <stop stopColor="#577dbe" offset="1" />
                </linearGradient>
                <linearGradient id="gh_j" x1="108.62" x2="108.62" y1="71.278" y2="32.087" gradientTransform="matrix(.98847 -.1514 -.1514 -.98847 359.52 1016.8)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#547dbf" offset="0" />
                    <stop stopColor="#18a1ce" offset="1" />
                </linearGradient>
                <linearGradient id="gh_c" x1="21.62" x2="50.082" y1="38.375" y2="5.439" gradientTransform="matrix(1 0 0 -1 328.04 1024.1)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#fcc010" offset="0" />
                    <stop stopColor="#32b55e" offset="1" />
                </linearGradient>
                <linearGradient id="gh_d" x1="62.695" x2="62.695" y1="154.54" y2="110.29" gradientTransform="matrix(.94765 .31932 .31932 -.94765 247.31 1054.1)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#ef4b5a" offset="0" />
                    <stop stopColor="#fabe0f" offset="1" />
                </linearGradient>
                <linearGradient id="gh_e" x1="82.325" x2="66.325" y1="137.09" y2="136.59" gradientTransform="matrix(1 0 0 -1 328.04 1024.1)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#d769a9" offset="0" />
                    <stop stopColor="#ef4b5a" offset="1" />
                </linearGradient>
                <linearGradient id="gh_f" x1="135.62" x2="137.12" y1="76.153" y2="65.153" gradientTransform="matrix(1 0 0 -1 328.04 1024.1)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#537dbf" offset="0" />
                    <stop stopColor="#18a1ce" offset="1" />
                </linearGradient>
                <linearGradient id="gh_g" x1="136.14" x2="120.64" y1="39.516" y2="17.516" gradientTransform="matrix(1 0 0 -1 328.04 1024.1)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#18a1ce" offset="0" />
                    <stop stopColor="#32b55e" offset="1" />
                </linearGradient>
                <linearGradient id="gh_h" x1="24.141" x2="45.641" y1="30.047" y2="13.547" gradientTransform="matrix(1 0 0 -1 328.04 1024.1)" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#fcc010" offset="0" />
                    <stop stopColor="#32b55e" offset="1" />
                </linearGradient>
            </defs>
            <g transform="translate(-328 -868)">
                <path d="m480.37 934.89-34.021 12.688 0.37696 0.36719v38.18h-4.2774l35.572 29.43c2.468-3.1985 3.9356-7.2083 3.9356-11.561v-60.949c0-2.8217-0.54965-5.5868-1.5859-8.1543z" fill="#18a1ce" />
                <path d="m363.28 962.93-35.23 2.0723v24.629l35.23-13.566z" fill="#fcc010" />
                <path d="m391.24 986.13-17.053 36.811h88.832c8.0041 0 14.848-4.9659 17.621-11.984l-37.238-24.826z" fill="#32b55e" />
                <path d="m388 874.01c-0.6081 0.50613-1.1995 1.0446-1.7695 1.6152l-46.359 46.441 33.438 15.912 25.751-25.572z" fill="#ef4b5a" />
                <path d="m454.22 906.61-22.916 26.285 15.42 15.055v2.4004l35.23-5.2207v-2.0801c0-5.84-2.3498-11.441-6.5098-15.541z" fill="#537dbf" />
                <path d="m363.27 986.13h27.961l-17.053 36.809h-27.198c-10.46 0-18.94-8.48-18.94-18.94v-14.368l35.23-13.566z" fill="url(#gh_h)" />
                <path d="m481.95 989.49v14.513c0 10.46-8.48 18.94-18.94 18.94h-2.661l-32.995-36.809h19.366v-11.116z" fill="url(#gh_g)" />
                <path d="m481.95 960.56h-35.23v-10.212l35.23-5.22z" fill="url(#gh_f)" />
                <path d="m405.16 868.07c-5.1332-0.13064-10.292 1.2738-14.75 4.1836-0.64321 0.49084-1.6472 1.1372-2.1699 1.5664-0.081 0.0659-0.15395 0.14591-0.23437 0.21289l9.1367 40.285h2e-3l7.5-7.4473 6.8378 6.6758 10.348-38.801c-4.736-4.3-10.682-6.5234-16.67-6.6758z" fill="url(#gh_e)" />
                <path d="m339.8 922.15-5.373 5.3809c-4.08 4.09-6.3809 9.6302-6.3809 15.41v21.947l35.23 11.871v-28.809l13.451-13.357z" fill="url(#gh_d)" />
                <path d="m363.28 973.86-35.213 30.984c3e-5 6e-4 -3e-5 0 0 0 0.44241 10.068 8.7453 18.096 18.922 18.096h27.443l34.553-36.811h-45.705z" fill="url(#gh_c)" />
                <path d="m474.93 927-42.93 6.5742 14.721 14.371-1e-5 23.023 35.23-5.3965 1e-5 -22.527c0-5.84-2.3498-11.441-6.5098-15.541z" fill="url(#gh_j)" fillOpacity=".5" />
                <path d="m418.96 872.49-8.8574 39.713 35.225 34.387 8.9121-39.957-31.639-31.154c-1.1407-1.1238-2.3608-2.12-3.6406-2.9883z" fill="url(#gh_i)" />
                <path d="m358.35 981.03a35.39 44.079 54.205 0 0-30.307 8.9375v14.029c0 10.46 8.4794 18.941 18.939 18.941h40.041a35.39 44.079 54.205 0 0-3.7754-29.174 35.39 44.079 54.205 0 0-8.1934-7.6367h-11.781l1e-5 -4.5078a35.39 44.079 54.205 0 0-4.9238-0.58985z" fill="url(#gh_b)" />
                <path d="m338.57 949.03a35.39 44.079 83.154 0 0-5.2891 0.37695 35.39 44.079 83.154 0 0-5.2324 0.88672v53.703c0 6.7628 3.5441 12.698 8.877 16.049a35.39 44.079 83.154 0 0 4.793-0.3633 35.39 44.079 83.154 0 0 39.543-33.555h-17.982v-31.414a35.39 44.079 83.154 0 0-24.709-5.6836z" fill="url(#gh_a)" />
            </g>
        </svg>
    );
}

function SyncIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
    );
}

function UnlinkIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
    );
}
