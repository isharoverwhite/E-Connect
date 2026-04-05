/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import Sidebar from "@/components/Sidebar";
import { AutomationRecord, AutomationListFilter, AutomationScheduleContext, AutomationMutationPayload } from "@/types/automation";
import { fetchAutomations, fetchAutomationScheduleContext, deleteAutomation, updateAutomation } from "@/lib/api-automation";
import { getAutomationGraphSummary, getAutomationGraphReadiness, getReadinessClasses, formatAutomationRunTime } from "@/lib/automation-utils";

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10 mb-6">
      <span className="material-icons-round mt-0.5 text-rose-500 dark:text-rose-400">error</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 text-xs font-bold text-rose-600 underline dark:text-rose-300">
          Retry
        </button>
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <span className="material-icons-round text-4xl text-primary">account_tree</span>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">No automations yet</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400 max-w-sm">
          Create an automation graph. Build rules to react to your devices in real-time.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-white transition hover:bg-blue-600 shadow"
      >
        <span className="material-icons-round text-sm">add</span> Create Automation
      </button>
    </div>
  );
}

export default function AutomationListPage() {
  const router = useRouter();
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [scheduleContext, setScheduleContext] = useState<AutomationScheduleContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AutomationListFilter>("all");

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const loadAutomations = async () => {
    try {
      setLoading(true);
      setError("");
      const [data, nextScheduleContext] = await Promise.all([
        fetchAutomations(),
        fetchAutomationScheduleContext().catch(() => null),
      ]);
      setAutomations(data);
      setScheduleContext(nextScheduleContext);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      setIsDeleting(true);
      await deleteAutomation(deletingId);
      setAutomations((prev) => prev.filter((a) => a.id !== deletingId));
      setDeletingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete automation");
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggle = async (e: React.MouseEvent, automation: AutomationRecord) => {
    e.stopPropagation();
    try {
      setTogglingId(automation.id);
      const payload: AutomationMutationPayload = automation.graph
        ? {
            name: automation.name,
            is_enabled: !automation.is_enabled,
            graph: automation.graph,
          }
        : {
            name: automation.name,
            is_enabled: !automation.is_enabled,
            script_code: automation.script_code ?? "",
            schedule_type: automation.schedule_type,
            timezone: automation.timezone,
            schedule_hour: automation.schedule_hour,
            schedule_minute: automation.schedule_minute,
            schedule_weekdays: automation.schedule_weekdays,
          };
      const updated = await updateAutomation(automation.id, payload);
      setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle automation");
    } finally {
      setTogglingId(null);
    }
  };

  const effectiveTimezone = scheduleContext?.effective_timezone ?? null;

  useEffect(() => {
    void loadAutomations();
  }, []);

  const filteredAutomations = automations.filter((automation) => {
    if (filter === "enabled" && !automation.is_enabled) return false;
    if (filter === "disabled" && automation.is_enabled) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!automation.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const enabledAutomations = filteredAutomations.filter((a) => a.is_enabled);
  const disabledAutomations = filteredAutomations.filter((a) => !a.is_enabled);

  function renderAutomationRows(items: AutomationRecord[], sectionTitle: string) {
    if (items.length === 0) return null;

    return (
      <div className="space-y-3 mb-8">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{sectionTitle}</span>
          <span className="text-[11px] font-medium text-slate-400">{items.length} items</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((automation) => {
            const readiness = getAutomationGraphReadiness(automation.graph);
            return (
              <div
                key={automation.id}
                onClick={() => router.push(`/automation/${automation.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/automation/${automation.id}`);
                  }
                }}
                className="group cursor-pointer flex flex-col text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-start justify-between gap-3 mb-3 w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      <span className="material-icons-round text-[18px]">account_tree</span>
                    </div>
                    <span className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{automation.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${getReadinessClasses(readiness.tone)}`}>
                      {readiness.label}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleToggle(e, automation)}
                      disabled={togglingId === automation.id}
                      className={`opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity h-6 w-6 rounded-lg flex items-center justify-center focus:outline-none focus:ring-2 ${
                        togglingId === automation.id
                          ? "opacity-50 cursor-wait text-slate-400"
                          : automation.is_enabled
                          ? "text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/10 dark:hover:text-amber-400 focus:ring-amber-500/50"
                          : "text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400 focus:ring-emerald-500/50"
                      }`}
                      title={automation.is_enabled ? "Pause rule" : "Start rule"}
                      aria-label={automation.is_enabled ? "Pause rule" : "Start rule"}
                    >
                      {togglingId === automation.id ? (
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300"></div>
                      ) : (
                        <span className="material-icons-round text-[16px]">
                          {automation.is_enabled ? "pause" : "play_arrow"}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(automation.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity h-6 w-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                      title="Delete rule"
                      aria-label="Delete rule"
                    >
                      <span className="material-icons-round text-[16px]">delete_outline</span>
                    </button>
                  </div>
                </div>

                <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2 h-10 mb-4 select-none">
                  {getAutomationGraphSummary(automation.graph)}
                </p>

                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800 w-full text-[11px] text-slate-500 font-medium select-none">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${automation.is_enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}></span>
                    {automation.is_enabled ? "Enabled" : "Paused"}
                  </span>
                  <span className={`truncate ${automation.last_execution ? (automation.last_execution.status === 'failed' ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400 font-semibold') : ''}`} title={automation.last_triggered ? formatAutomationRunTime(automation.last_triggered, effectiveTimezone) : "Never run"}>
                    {automation.last_execution ? `Run: ${automation.last_execution.status}` : (automation.last_triggered ? formatAutomationRunTime(automation.last_triggered, effectiveTimezone) : "Never")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-surface-light dark:bg-surface-dark overflow-hidden font-sans text-slate-900 dark:text-slate-100">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-6 lg:p-10">
          <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                <span className="material-icons-round text-primary text-[32px]">account_tree</span>
                Automations
              </h1>
              <p className="mt-2 max-w-2xl text-base text-slate-500 dark:text-slate-400">
                Create and manage rules to orchestrate your smart home devices automatically.
              </p>
              {effectiveTimezone && (
                <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
                  Run timestamps use {effectiveTimezone}.
                </p>
              )}
            </div>
            {automations.length > 0 && (
              <button
                onClick={() => router.push('/automation/new')}
                className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 shadow-sm"
              >
                <span className="material-icons-round text-[18px]">add</span> Create Rule
              </button>
            )}
          </header>

          {error && <ErrorBanner message={error} onRetry={loadAutomations} />}

          {loading ? (
            <div className="flex items-center justify-center p-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary dark:border-slate-800"></div>
            </div>
          ) : automations.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-sm">
              <EmptyState onCreate={() => router.push('/automation/new')} />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Toolbar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-1">
                  {([
                    ["all", "All Rules"],
                    ["enabled", "Enabled"],
                    ["disabled", "Paused"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setFilter(value)}
                      className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition ${
                        filter === value
                          ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-300"
                      }`}
                    >
                      {label}
                      <span className="ml-2 rounded-full bg-slate-200/50 dark:bg-slate-700/50 px-2 py-0.5 text-[10px]">
                        {value === "all" ? automations.length : value === "enabled" ? automations.filter(a => a.is_enabled).length : automations.filter(a => !a.is_enabled).length}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-auto">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 material-icons-round text-[18px] text-slate-400">search</span>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search automations..."
                    className="w-full sm:w-64 rounded-xl border-none bg-slate-50 dark:bg-slate-950 px-10 py-2.5 text-sm text-slate-900 transition focus:ring-2 focus:ring-primary dark:text-white placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* Grid content */}
              <div className="pt-2">
                {filteredAutomations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                    <span className="material-icons-round text-4xl text-slate-300 dark:text-slate-600 mb-3">search_off</span>
                    <p className="text-slate-500 dark:text-slate-400 font-medium tracking-wide">No rules match your filters.</p>
                  </div>
                ) : filter === "all" ? (
                  <>
                    {renderAutomationRows(enabledAutomations, "Active Automations")}
                    {renderAutomationRows(disabledAutomations, "Paused Automations")}
                  </>
                ) : (
                  renderAutomationRows(filteredAutomations, filter === "enabled" ? "Active Automations" : "Paused Automations")
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <ConfirmModal
        isOpen={deletingId !== null}
        title="Delete Automation"
        message="Are you sure you want to delete this automation rule? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setDeletingId(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
