"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
} from "@/lib/api";

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

function toLocalDateKey(value: string): string {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatEventDateTime(value?: string | null): string {
    if (!value) {
        return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(new Date(value));
}

function formatDayLabel(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
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
    const [error, setError] = useState("");
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());

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

    async function handleRefresh() {
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
    }

    useWebSocket((event) => {
        if (event.type !== "system_metrics" || !event.payload) {
            return;
        }

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
    });

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

            const localDate = toLocalDateKey(entry.occurred_at);
            if (fromDate && localDate < fromDate) {
                return false;
            }
            if (toDate && localDate > toDate) {
                return false;
            }

            if (deferredSearch && !buildSearchIndex(entry).includes(deferredSearch)) {
                return false;
            }

            return true;
        });
    }, [categoryFilter, deferredSearch, fromDate, logs, severityFilter, toDate]);

    const groupedLogs = useMemo(() => {
        const groups = new Map<string, SystemLogEntry[]>();

        filteredLogs.forEach((entry) => {
            const key = toLocalDateKey(entry.occurred_at);
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
    }, [filteredLogs]);

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
                tone: status.mqtt_status === "connected" ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300",
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
                            <button
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                disabled={refreshing}
                                onClick={() => void handleRefresh()}
                            >
                                <span className={`material-icons-round text-[18px] ${refreshing ? "animate-spin" : ""}`}>refresh</span>
                                Refresh
                            </button>
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
                                                    : "Live server diagnostics are streaming from the active backend runtime."}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-current/15 bg-white/70 px-4 py-3 text-sm shadow-sm dark:bg-slate-950/30">
                                            <p className="text-xs uppercase tracking-[0.2em] opacity-70">Advertised host</p>
                                            <p className="mt-2 text-lg font-semibold">{status?.advertised_host ?? "Unknown"}</p>
                                            <p className="mt-2 text-xs opacity-70">
                                                Latest alert: {formatEventDateTime(status?.latest_alert_at)}
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
                                            Warning, error, and critical events retained for {status?.retention_days ?? 30} days.
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

                                                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                                                    <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
                                                        <thead className="bg-slate-50 dark:bg-slate-900/80">
                                                            <tr>
                                                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Time</th>
                                                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Severity</th>
                                                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Category</th>
                                                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Event</th>
                                                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Firmware</th>
                                                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Device</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
                                                            {group.entries.map((entry) => (
                                                                <tr key={entry.id} className="align-top">
                                                                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                                                                        {new Intl.DateTimeFormat(undefined, {
                                                                            hour: "2-digit",
                                                                            minute: "2-digit",
                                                                            second: "2-digit",
                                                                        }).format(new Date(entry.occurred_at))}
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${severityToneMap[entry.severity]}`}>
                                                                            {entry.severity}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                                        {categoryLabelMap[entry.category]}
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <div className="min-w-[20rem]">
                                                                            <p className="font-medium text-slate-900 dark:text-white">{entry.message}</p>
                                                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                                                {entry.event_code} • {formatEventDateTime(entry.occurred_at)}
                                                                            </p>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                                        {entry.firmware_version || entry.firmware_revision
                                                                            ? (
                                                                                <>
                                                                                    <div>{entry.firmware_version ?? "Unknown version"}</div>
                                                                                    <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                                                                        {entry.firmware_revision ?? "No revision"}
                                                                                    </div>
                                                                                </>
                                                                            )
                                                                            : "—"}
                                                                    </td>
                                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                                        {entry.device_id ?? "Server"}
                                                                    </td>
                                                                </tr>
                                                            ))}
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
