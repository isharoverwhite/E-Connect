/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/components/ToastContext";
import { useLanguage } from "@/components/LanguageContext";

interface TotpStatus { enabled: boolean }
interface TotpSetup { secret: string; provisioning_uri: string }

async function fetchTotpStatus(token: string): Promise<TotpStatus> {
    const res = await fetch("/api/v1/auth/totp/status", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("Failed to fetch 2FA status");
    return res.json();
}

async function fetchTotpSetup(token: string): Promise<TotpSetup> {
    const res = await fetch("/api/v1/auth/totp/setup", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("Failed to initialize 2FA setup");
    return res.json();
}

async function enableTotp(token: string, code: string): Promise<void> {
    const res = await fetch("/api/v1/auth/totp/enable", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? "Invalid code");
    }
}

async function disableTotp(token: string, password: string): Promise<void> {
    const res = await fetch("/api/v1/auth/totp/disable", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? "Incorrect password");
    }
}

export function TwoFactorPanel() {
    const { showToast } = useToast();
    const { t } = useLanguage();

    const [status, setStatus] = useState<TotpStatus | null>(null);
    const [loading, setLoading] = useState(true);

    // setup flow
    const [setupData, setSetupData] = useState<TotpSetup | null>(null);
    const [setupLoading, setSetupLoading] = useState(false);
    const [enableCode, setEnableCode] = useState("");
    const [enableLoading, setEnableLoading] = useState(false);
    const [enableError, setEnableError] = useState("");
    const [secretVisible, setSecretVisible] = useState(false);
    const [copied, setCopied] = useState(false);

    // disable flow
    const [showDisable, setShowDisable] = useState(false);
    const [disablePassword, setDisablePassword] = useState("");
    const [disableLoading, setDisableLoading] = useState(false);
    const [disableError, setDisableError] = useState("");

    async function load() {
        const token = getToken();
        if (!token) return;
        setLoading(true);
        try {
            setStatus(await fetchTotpStatus(token));
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }

    useEffect(() => { load(); }, []); // mount only

    async function handleStartSetup() {
        const token = getToken();
        if (!token) return;
        setSetupLoading(true);
        setEnableCode("");
        setEnableError("");
        setSecretVisible(false);
        try {
            setSetupData(await fetchTotpSetup(token));
        } catch { showToast(t("security.2fa.setup_error"), "error"); }
        finally { setSetupLoading(false); }
    }

    async function handleEnable(e: React.FormEvent) {
        e.preventDefault();
        const token = getToken();
        if (!token || !enableCode.trim()) return;
        setEnableLoading(true);
        setEnableError("");
        try {
            await enableTotp(token, enableCode.trim());
            showToast(t("security.2fa.enabled_toast"), "success");
            setSetupData(null);
            setEnableCode("");
            await load();
        } catch (err) {
            setEnableError(err instanceof Error ? err.message : t("security.2fa.invalid_code"));
        } finally { setEnableLoading(false); }
    }

    async function handleDisable(e: React.FormEvent) {
        e.preventDefault();
        const token = getToken();
        if (!token || !disablePassword) return;
        setDisableLoading(true);
        setDisableError("");
        try {
            await disableTotp(token, disablePassword);
            showToast(t("security.2fa.disabled_toast"), "success");
            setShowDisable(false);
            setDisablePassword("");
            await load();
        } catch (err) {
            setDisableError(err instanceof Error ? err.message : t("security.2fa.disable_error"));
        } finally { setDisableLoading(false); }
    }

    async function copySecret() {
        if (!setupData) return;
        await navigator.clipboard.writeText(setupData.secret);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    if (loading) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 animate-pulse h-40" />
        );
    }

    return (
        <div className="space-y-4">
            {/* Status card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${status?.enabled ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-slate-100 dark:bg-slate-800"}`}>
                            <ShieldIcon className={`w-5 h-5 ${status?.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("security.2fa.title")}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("security.2fa.description")}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status?.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                            {status?.enabled ? t("security.2fa.status_on") : t("security.2fa.status_off")}
                        </span>
                        {status?.enabled ? (
                            <button
                                onClick={() => { setShowDisable(true); setDisablePassword(""); setDisableError(""); }}
                                className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg transition-colors"
                            >
                                {t("security.2fa.disable_btn")}
                            </button>
                        ) : (
                            <button
                                onClick={handleStartSetup}
                                disabled={setupLoading || !!setupData}
                                className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                            >
                                {setupLoading ? t("security.2fa.setting_up") : t("security.2fa.enable_btn")}
                            </button>
                        )}
                    </div>
                </div>
            </section>

            {/* Setup flow */}
            {setupData && !status?.enabled && (
                <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6 dark:border-indigo-800/50 dark:bg-indigo-900/10">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">1</span>
                        {t("security.2fa.step1_title")}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">{t("security.2fa.step1_hint")}</p>

                    {/* Open in app link */}
                    <a
                        href={setupData.provisioning_uri}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors mb-4"
                    >
                        <PhoneIcon className="w-4 h-4" />
                        {t("security.2fa.open_app")}
                    </a>

                    {/* Manual key */}
                    <div className="mt-2">
                        <button
                            onClick={() => setSecretVisible(!secretVisible)}
                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline underline-offset-2 transition-colors mb-2"
                        >
                            {secretVisible ? t("security.2fa.hide_key") : t("security.2fa.show_key")}
                        </button>
                        {secretVisible && (
                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-3">
                                <code className="text-xs font-mono text-slate-800 dark:text-slate-200 flex-1 break-all tracking-widest">
                                    {setupData.secret}
                                </code>
                                <button
                                    onClick={copySecret}
                                    className="ml-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex-shrink-0"
                                >
                                    {copied ? t("security.2fa.copied") : t("security.2fa.copy_key")}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Step 2: verify code */}
                    <div className="mt-6 pt-5 border-t border-indigo-200/60 dark:border-indigo-800/40">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">2</span>
                            {t("security.2fa.step2_title")}
                        </h4>
                        <form onSubmit={handleEnable} className="flex items-start gap-3 flex-wrap">
                            <div className="flex-1 min-w-[180px]">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={8}
                                    value={enableCode}
                                    onChange={(e) => { setEnableCode(e.target.value.replace(/\D/g, "")); setEnableError(""); }}
                                    placeholder="000000"
                                    className="w-full text-center font-mono text-lg tracking-[0.4em] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl py-3 px-4 text-slate-900 dark:text-white placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    autoComplete="one-time-code"
                                    required
                                />
                                {enableError && <p className="text-xs text-red-500 mt-1.5">{enableError}</p>}
                            </div>
                            <button
                                type="submit"
                                disabled={enableLoading || enableCode.length < 6}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-3 rounded-xl transition disabled:opacity-60 flex-shrink-0"
                            >
                                {enableLoading ? t("security.2fa.verifying") : t("security.2fa.verify_enable")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setSetupData(null)}
                                className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 px-5 py-3"
                            >
                                {t("security.2fa.cancel")}
                            </button>
                        </form>
                    </div>
                </section>
            )}

            {/* Disable flow */}
            {showDisable && (
                <section className="rounded-2xl border border-red-200 bg-red-50/50 p-6 dark:border-red-800/50 dark:bg-red-900/10">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{t("security.2fa.disable_confirm_title")}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t("security.2fa.disable_confirm_hint")}</p>
                    <form onSubmit={handleDisable} className="flex items-start gap-3 flex-wrap">
                        <div className="flex-1 min-w-[200px]">
                            <input
                                type="password"
                                value={disablePassword}
                                onChange={(e) => { setDisablePassword(e.target.value); setDisableError(""); }}
                                placeholder={t("security.2fa.password_placeholder")}
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl py-2.5 px-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                required
                                autoComplete="current-password"
                            />
                            {disableError && <p className="text-xs text-red-500 mt-1.5">{disableError}</p>}
                        </div>
                        <button
                            type="submit"
                            disabled={disableLoading || !disablePassword}
                            className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition disabled:opacity-60 flex-shrink-0"
                        >
                            {disableLoading ? t("security.2fa.disabling") : t("security.2fa.confirm_disable")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowDisable(false)}
                            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 px-4 py-2.5"
                        >
                            {t("security.2fa.cancel")}
                        </button>
                    </form>
                </section>
            )}

            {/* Login lockout info */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3 mb-2">
                    <LockIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("security.lockout.title")}</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t("security.lockout.description")}
                </p>
            </section>
        </div>
    );
}

function ShieldIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
    );
}

function PhoneIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3" />
        </svg>
    );
}

function LockIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
    );
}
