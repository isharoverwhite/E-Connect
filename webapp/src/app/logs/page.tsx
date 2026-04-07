/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import Sidebar from "@/components/Sidebar";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
    SystemLogCategory,
    SystemLogEntry,
    SystemLogSeverity,
    SystemStatusResponse,
    fetchSystemLogs,
    fetchSystemStatus,
    markAllSystemLogsRead,
    markSystemLogRead,
} from "@/lib/api";
import { isSystemLogAlertEntry } from "@/lib/system-log";

type SeverityFilter = "all" | "alerts" | SystemLogSeverity;
type CategoryFilter = "all" | SystemLogCategory;

const severityToneMap: Record<SystemLogSeverity, string> = {
    info: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
    error: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    critical: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-200",
};

const categoryLabelMap: Record<SystemLogCategory, string> = {
    lifecycle: "Lifecycle",
    connectivity: "Connectivity",
    firmware: "Firmware",
    health: "Health",
};

const statusToneMap: Record<SystemStatusResponse["overall_status"], string> = {
    healthy: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
    critical: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
};

function parseApiDate(value?: string | null): Date | null {
    if (!value) {
        return null;
    }

    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toServerDateKey(value: string, timezone: string): string {
    const parsed = parseApiDate(value);
    if (!parsed) {
        return "";
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(parsed);

    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const day = parts.find((part) => part.type === "day")?.value ?? "00";
    return `${year}-${month}-${day}`;
}

function formatEventDateTime(value: string | null | undefined, timezone: string): string {
    const parsed = parseApiDate(value);
    if (!parsed) {
        return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: timezone,
    }).format(parsed);
}

function formatEventTime(value: string | null | undefined, timezone: string): string {
    const parsed = parseApiDate(value);
    if (!parsed) {
        return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: timezone,
    }).format(parsed);
}

function formatDayLabel(value: string): string {
    const [year, month, day] = value.split("-").map(Number);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
        return value;
    }
    const anchor = new Date(Date.UTC(year, Math.max(0, month - 1), day, 12, 0, 0));
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    }).format(anchor);
}

function formatUsageLabel(used: number, total: number): string {
    if (total <= 0) {
        return "0 / 0";
    }

    const usedInGb = used / 1024 / 1024 / 1024;
    const totalInGb = total / 1024 / 1024 / 1024;
    return `${usedInGb.toFixed(1)} GB / ${totalInGb.toFixed(1)} GB`;
}

function formatDuration(totalSeconds: number): string {
    if (totalSeconds <= 0) {
        return "Just started";
    }

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

function buildSearchIndex(entry: SystemLogEntry): string {
    return [
        entry.event_code,
        entry.message,
        entry.device_id ?? "",
        entry.firmware_version ?? "",
        entry.firmware_revision ?? "",
        entry.details ? JSON.stringify(entry.details) : "",
    ]
        .join(" ")
        .toLowerCase();
}

async function requestLogsPageData(): Promise<{
    nextStatus: SystemStatusResponse;
    nextLogs: SystemLogEntry[];
}> {
    const [nextStatus, nextLogs] = await Promise.all([
        fetchSystemStatus(),
        fetchSystemLogs(undefined, 500),
    ]);

    return {
        nextStatus,
        nextLogs: nextLogs.entries,
    };
}

export default function LogsPage() {
    const { user } = useAuth();
    const searchParams = useSearchParams();
    const isAdmin = user?.account_type === "admin";

    const [status, setStatus] = useState<SystemStatusResponse | null>(null);
    const [logs, setLogs] = useState<SystemLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const [markingIds, setMarkingIds] = useState<Set<number>>(new Set());
    const [error, setError] = useState("");
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
    const effectiveTimezone = status?.effective_timezone ?? "UTC";

    useEffect(() => {
        const requestedView = searchParams.get("view");
        setSeverityFilter(requestedView === "alerts" ? "alerts" : "all");
    }, [searchParams]);

    useEffect(() => {
        let cancelled = false;

        if (!isAdmin) {
            setLoading(false);
            setRefreshing(false);
            setStatus(null);
            setLogs([]);
            setError("");
            return;
        }

        setLoading(true);
        setError("");

        void (async () => {
            try {
                const { nextStatus, nextLogs } = await requestLogsPageData();
                if (cancelled) {
                    return;
                }
                setStatus(nextStatus);
                setLogs(nextLogs);
            } catch (loadError) {
                if (cancelled) {
                    return;
                }
                const message = loadError instanceof Error ? loadError.message : "Failed to load logs and stats";
                setError(message);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isAdmin]);

    const handleRefresh = useCallback(async () => {
        if (!isAdmin) {
            return;
        }

        setRefreshing(true);
        setError("");

        try {
            const { nextStatus, nextLogs } = await requestLogsPageData();
            setStatus(nextStatus);
            setLogs(nextLogs);
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : "Failed to load logs and stats";
            setError(message);
        } finally {
            setRefreshing(false);
        }
    }, [isAdmin]);

    async function handleMarkRead(logId: number) {
        if (!isAdmin) {
            return;
        }

        setError("");
        setMarkingIds((current) => new Set(current).add(logId));

        try {
            await markSystemLogRead(logId);
            const { nextStatus, nextLogs } = await requestLogsPageData();
            setStatus(nextStatus);
            setLogs(nextLogs);
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : "Failed to mark alert as read";
            setError(message);
        } finally {
            setMarkingIds((current) => {
                const next = new Set(current);
                next.delete(logId);
                return next;
            });
        }
    }

    async function handleMarkAllRead() {
        if (!isAdmin) {
            return;
        }

        setError("");
        setMarkingAll(true);

        try {
            await markAllSystemLogsRead();
            const { nextStatus, nextLogs } = await requestLogsPageData();
            setStatus(nextStatus);
            setLogs(nextLogs);
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : "Failed to mark all alerts as read";
            setError(message);
        } finally {
            setMarkingAll(false);
        }
    }

    const { isConnected } = useWebSocket((event) => {
        if (event.type === "system_metrics" && event.payload) {
            const metrics = event.payload as Record<string, unknown>;
            setStatus((current) => {
                if (!current) {
                    return current;
                }

                return {
                    ...current,
                    cpu_percent: typeof metrics.cpu_percent === "number" ? metrics.cpu_percent : current.cpu_percent,
                    memory_used: typeof metrics.memory_used === "number" ? metrics.memory_used : current.memory_used,
                    memory_total: typeof metrics.memory_total === "number" ? metrics.memory_total : current.memory_total,
                    storage_used: typeof metrics.storage_used === "number" ? metrics.storage_used : current.storage_used,
                    storage_total: typeof metrics.storage_total === "number" ? metrics.storage_total : current.storage_total,
                };
            });
            return;
        }

        if (
            event.type === "device_online" ||
            event.type === "device_offline" ||
            event.type === "pairing_requested" ||
            event.type === "pairing_queue_updated"
        ) {
            if (!refreshing && isAdmin) {
                void handleRefresh();
            }
        }
    });

    useEffect(() => {
        if (!isConnected || !isAdmin) {
            return;
        }

        let cancelled = false;
        const timeoutId = window.setTimeout(() => {
            if (!cancelled && !loading) {
                void handleRefresh();
            }
        }, 500);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [isConnected, isAdmin, handleRefresh, loading]);

    const filteredLogs = useMemo(() => {
        return logs.filter((entry) => {
            if (severityFilter === "alerts" && entry.severity === "info") {
                return false;
            }

            if (severityFilter !== "all" && severityFilter !== "alerts" && entry.severity !== severityFilter) {
                return false;
            }

            if (categoryFilter !== "all" && entry.category !== categoryFilter) {
                return false;
            }

            const serverDate = toServerDateKey(entry.occurred_at, effectiveTimezone);
            if (!serverDate) {
                return false;
            }

            if (fromDate && serverDate < fromDate) {
                return false;
            }
            if (toDate && serverDate > toDate) {
                return false;
            }

            if (deferredSearch && !buildSearchIndex(entry).includes(deferredSearch)) {
                return false;
            }

            return true;
        });
    }, [categoryFilter, deferredSearch, effectiveTimezone, fromDate, logs, severityFilter, toDate]);

    const groupedLogs = useMemo(() => {
        const groups = new Map<string, SystemLogEntry[]>();

        filteredLogs.forEach((entry) => {
            const key = toServerDateKey(entry.occurred_at, effectiveTimezone);
            if (!key) {
                return;
            }
            const bucket = groups.get(key);
            if (bucket) {
                bucket.push(entry);
                return;
            }
            groups.set(key, [entry]);
        });

        return Array.from(groups.entries()).map(([dateKey, entries]) => ({
            dateKey,
            label: formatDayLabel(dateKey),
            entries,
        }));
    }, [effectiveTimezone, filteredLogs]);

    const metrics = status
        ? [
            {
                label: "Database",
                value: status.database_status === "ok" ? "Connected" : "Unavailable",
                tone: status.database_status === "ok" ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300",
            },
            {
                label: "MQTT",
                value: status.mqtt_status === "connected" ? "Connected" : "Disconnected",
                tone: status.mqtt_status === "connected" ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300",
            },
            {
                label: "CPU",
                value: `${status.cpu_percent.toFixed(1)}%`,
                tone: "text-slate-900 dark:text-white",
            },
            {
                label: "Uptime",
                value: formatDuration(status.uptime_seconds),
                tone: "text-slate-900 dark:text-white",
            },
        ]
        : [];

    return (
        <div className="flex min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <Sidebar />

            <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:px-8">
                    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Operations</p>
                            <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">Logs & Stats</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                                Track server health, firmware observations, and alert-worthy events across the rolling 30-day window.
                            </p>
                        </div>
                        {isAdmin ? (
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                    disabled={markingAll || refreshing || !status || status.active_alert_count === 0}
                                    onClick={() => void handleMarkAllRead()}
                                >
                                    <span className={`material-icons-round text-[18px] ${markingAll ? "animate-spin" : ""}`}>
                                        {markingAll ? "autorenew" : "mark_email_read"}
                                    </span>
                                    Mark All Read
                                </button>
                                <button
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                    disabled={markingAll || refreshing}
                                    onClick={() => void handleRefresh()}
                                >
                                    <span className={`material-icons-round text-[18px] ${refreshing ? "animate-spin" : ""}`}>refresh</span>
                                    Refresh
                                </button>
                            </div>
                        ) : null}
                    </header>

                    {!isAdmin ? (
                        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-500/20 dark:bg-amber-500/10">
                            <div className="flex items-start gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                    <span className="material-icons-round text-2xl">admin_panel_settings</span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Admin access required</h2>
                                    <p className="mt-2 text-sm text-amber-900/80 dark:text-amber-100/80">
                                        This page contains instance diagnostics and operational alerts. Sign in with an admin account to view server history.
                                    </p>
                                </div>
                            </div>
                        </section>
                    ) : (
                        <>
                            {error ? (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                                    {error}
                                </div>
                            ) : null}

                            <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
                                <div className={`rounded-3xl border p-6 shadow-sm ${status ? statusToneMap[status.overall_status] : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"}`}>
                                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <p className="text-sm font-medium uppercase tracking-[0.2em]">Current Status</p>
                                            <h2 className="mt-2 text-3xl font-semibold capitalize">{status?.overall_status ?? "Loading"}</h2>
                                            <p className="mt-3 max-w-2xl text-sm opacity-90">
                                                {status?.latest_alert_message
                                                    ? status.latest_alert_message
                                                    : "All current alerts are marked as read. Live dependency cards below still show the current runtime state."}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-current/15 bg-white/70 px-4 py-3 text-sm shadow-sm dark:bg-slate-950/30">
                                            <p className="text-xs uppercase tracking-[0.2em] opacity-70">Advertised host</p>
                                            <p className="mt-2 text-lg font-semibold">{status?.advertised_host ?? "Unknown"}</p>
                                            <p className="mt-2 text-xs opacity-70">
                                                Latest unread alert: {status?.latest_alert_at ? formatEventDateTime(status.latest_alert_at, effectiveTimezone) : "None"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                        {metrics.map((metric) => (
                                            <div key={metric.label} className="rounded-2xl border border-current/10 bg-white/70 p-4 shadow-sm dark:bg-slate-950/30">
                                                <p className="text-xs uppercase tracking-[0.2em] opacity-70">{metric.label}</p>
                                                <p className={`mt-2 text-lg font-semibold ${metric.tone}`}>{metric.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid gap-4">
                                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Alert Window</p>
                                        <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">
                                            {status ? status.active_alert_count.toString().padStart(2, "0") : "--"}
                                        </p>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                            Unread warning, error, and critical events retained for {status?.retention_days ?? 30} days.
                                        </p>
                                    </div>

                                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Resource Usage</p>
                                        <div className="mt-4 space-y-4">
                                            <div>
                                                <div className="flex items-center justify-between text-sm">
                                                    <span>Memory</span>
                                                    <span>{status ? formatUsageLabel(status.memory_used, status.memory_total) : "--"}</span>
                                                </div>
                                                <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                                                    <div
                                                        className="h-2 rounded-full bg-primary"
                                                        style={{
                                                            width: status && status.memory_total > 0
                                                                ? `${Math.min(100, (status.memory_used / status.memory_total) * 100)}%`
                                                                : "0%",
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex items-center justify-between text-sm">
                                                    <span>Storage</span>
                                                    <span>{status ? formatUsageLabel(status.storage_used, status.storage_total) : "--"}</span>
                                                </div>
                                                <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                                                    <div
                                                        className="h-2 rounded-full bg-slate-700 dark:bg-slate-200"
                                                        style={{
                                                            width: status && status.storage_total > 0
                                                                ? `${Math.min(100, (status.storage_used / status.storage_total) * 100)}%`
                                                                : "0%",
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                    <div>
                                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Activity Table</h2>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                            Search and narrow down server history without leaving the last 30-day retention window.
                                        </p>
                                        {status ? (
                                            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                                Timestamps and date filters use {status.effective_timezone}. Current server time: {formatEventDateTime(status.current_server_time, effectiveTimezone)}.
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <span>From date</span>
                                            <input
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                                                onChange={(event) => setFromDate(event.target.value)}
                                                type="date"
                                                value={fromDate}
                                            />
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <span>To date</span>
                                            <input
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                                                onChange={(event) => setToDate(event.target.value)}
                                                type="date"
                                                value={toDate}
                                            />
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <span>Severity</span>
                                            <select
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                                                onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                                                value={severityFilter}
                                            >
                                                <option value="all">All events</option>
                                                <option value="alerts">Alerts only</option>
                                                <option value="info">Info</option>
                                                <option value="warning">Warning</option>
                                                <option value="error">Error</option>
                                                <option value="critical">Critical</option>
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <span>Category</span>
                                            <select
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                                                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                                                value={categoryFilter}
                                            >
                                                <option value="all">All categories</option>
                                                <option value="lifecycle">Lifecycle</option>
                                                <option value="connectivity">Connectivity</option>
                                                <option value="firmware">Firmware</option>
                                                <option value="health">Health</option>
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <span>Search</span>
                                            <input
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                                                onChange={(event) => setSearchTerm(event.target.value)}
                                                placeholder="event, device, firmware..."
                                                type="search"
                                                value={searchTerm}
                                            />
                                        </label>
                                    </div>
                                </div>

                                {loading ? (
                                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                        Loading the latest system history...
                                    </div>
                                ) : groupedLogs.length === 0 ? (
                                    <div className="mt-6 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center dark:border-slate-700">
                                        <span className="material-icons-round text-4xl text-slate-300 dark:text-slate-600">history</span>
                                        <h3 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">No matching events</h3>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                            Adjust the filters or clear the search term to inspect the full 30-day retention window.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="mt-6 space-y-6">
                                        {groupedLogs.map((group) => (
                                            <section key={group.dateKey} className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                                        {group.label}
                                                    </h3>
                                                    <span className="text-xs text-slate-400 dark:text-slate-500">{group.entries.length} events</span>
                                                </div>

                                                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
                                                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                                                        <thead className="border-b border-slate-200 bg-slate-50/50 text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-400">
                                                            <tr>
                                                                <th className="px-4 py-3.5 font-medium">Time</th>
                                                                <th className="px-4 py-3.5 font-medium">Status & Category</th>
                                                                <th className="px-4 py-3.5 font-medium">Event Detail</th>
                                                                <th className="px-4 py-3.5 font-medium">Source</th>
                                                                <th className="px-4 py-3.5 font-medium text-right">Action</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                                            {group.entries.map((entry) => {
                                                                const isAlert = isSystemLogAlertEntry(entry);
                                                                const isMarking = markingIds.has(entry.id);

                                                                return (
                                                                <tr key={entry.id} className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/20 ${isAlert && entry.is_read ? "opacity-[0.65] bg-slate-50/30 dark:bg-slate-900/20" : ""}`}>
                                                                    <td className="px-4 py-4 align-top">
                                                                        <span className="font-medium text-slate-700 dark:text-slate-300">
                                                                            {formatEventTime(entry.occurred_at, effectiveTimezone)}
                                                                        </span>
                                                                    </td>

                                                                    <td className="px-4 py-4 align-top">
                                                                        <div className="flex flex-col items-start gap-2">
                                                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${severityToneMap[entry.severity]}`}>
                                                                                <span className="material-icons-round text-[14px]">
                                                                                    {entry.severity === 'info' ? 'info' : entry.severity === 'warning' ? 'warning' : entry.severity === 'error' ? 'error' : 'report'}
                                                                                </span>
                                                                                {entry.severity}
                                                                            </span>
                                                                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                                                                <span className="material-icons-round text-[12px] opacity-70">label</span>
                                                                                {categoryLabelMap[entry.category]}
                                                                            </span>
                                                                        </div>
                                                                    </td>

                                                                    <td className="min-w-[18rem] max-w-md whitespace-normal px-4 py-4 align-top">
                                                                        <div className="flex flex-col gap-1.5">
                                                                            <p className="font-medium leading-snug text-slate-900 dark:text-white">
                                                                                {entry.message}
                                                                            </p>
                                                                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800 dark:text-slate-300">
                                                                                    {entry.event_code}
                                                                                </span>
                                                                                {isAlert ? (
                                                                                    <span className={`inline-flex items-center gap-1 ${entry.is_read ? "text-slate-400" : "font-medium text-blue-600 dark:text-blue-400"}`}>
                                                                                        <span className="h-1.5 w-1.5 rounded-full bg-current"></span>
                                                                                        {entry.is_read && entry.read_at
                                                                                            ? `Read at ${formatEventTime(entry.read_at, effectiveTimezone)}`
                                                                                            : "Unread alert"}
                                                                                    </span>
                                                                                ) : null}
                                                                            </div>
                                                                        </div>
                                                                    </td>

                                                                    <td className="px-4 py-4 align-top">
                                                                        <div className="flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-300">
                                                                            <span className="inline-flex items-center gap-1.5">
                                                                                <span className="material-icons-round text-[14px] text-slate-400">memory</span>
                                                                                {entry.device_id ?? "Server"}
                                                                            </span>
                                                                            {(entry.firmware_version || entry.firmware_revision) && (
                                                                                <span className="inline-flex items-center gap-1.5">
                                                                                    <span className="material-icons-round text-[14px] text-slate-400">system_update_alt</span>
                                                                                    <span className="max-w-[120px] truncate" title={entry.firmware_version || "Unknown version"}>
                                                                                        {entry.firmware_version || "Unknown"}
                                                                                    </span>
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>

                                                                    <td className="px-4 py-4 align-top text-right">
                                                                        {isAlert ? (
                                                                            <button
                                                                                className="inline-flex min-w-[7.5rem] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary dark:hover:bg-slate-800"
                                                                                disabled={entry.is_read || isMarking || markingAll}
                                                                                onClick={() => void handleMarkRead(entry.id)}
                                                                            >
                                                                                <span className={`material-icons-round text-[14px] ${isMarking ? "animate-spin" : ""}`}>
                                                                                    {isMarking ? "autorenew" : entry.is_read ? "done_all" : "mark_email_read"}
                                                                                </span>
                                                                                {entry.is_read ? "Read" : "Mark Read"}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="block px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500">—</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            )})}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
