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
        <svg className={className} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="28" height="28" rx="8" fill="#4285F4" />
            <path d="M14 6a8 8 0 1 0 0 16A8 8 0 0 0 14 6Z" fill="white" fillOpacity=".15" />
            <circle cx="14" cy="11" r="3" fill="white" />
            <path d="M8 20c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
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
