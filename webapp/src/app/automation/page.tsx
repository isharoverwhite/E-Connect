"use client";

import { API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";

import { useCallback, useEffect, useRef, useState } from "react";

// --- Types ---
type ExecutionStatus = "success" | "failed";

interface AutomationRecord {
  id: number;
  name: string;
  script_code: string;
  is_enabled: boolean;
  last_triggered: string | null;
  creator_id: number;
}

interface ExecutionLog {
  id: number;
  automation_id: number;
  triggered_at: string;
  status: ExecutionStatus;
  log_output: string | null;
  error_message: string | null;
}

interface TriggerResult {
  status: ExecutionStatus;
  message: string;
  log: ExecutionLog | null;
}

type PageState = "loading" | "empty" | "loaded" | "error";
type TriggerState = "idle" | "pending" | "done";

const DEFAULT_SCRIPT = `# E-Connect Automation Script
# Available builtins: print(), len(), range()
# Variables: 'device_id' is provided when triggered via event.

import math

sensor_value = 42
threshold = 40

if sensor_value > threshold:
    print(f"Threshold exceeded: {sensor_value} > {threshold}")
    print("Action would be triggered here.")
else:
    print(f"All clear: {sensor_value} <= {threshold}")
`;

// --- API helpers ---
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchAutomations(): Promise<AutomationRecord[]> {
  const res = await fetch(`${API_URL}/automations`, {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load automations: ${res.status}`);
  return res.json() as Promise<AutomationRecord[]>;
}

async function createAutomation(name: string, script_code: string): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, script_code, is_enabled: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? `Create failed: ${res.status}`);
  }
  return res.json() as Promise<AutomationRecord>;
}

async function triggerAutomation(id: number): Promise<TriggerResult> {
  const res = await fetch(`${API_URL}/automation/${id}/trigger`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? `Trigger failed: ${res.status}`);
  }
  return res.json() as Promise<TriggerResult>;
}

// --- Subcomponents ---

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <span className="material-symbols-outlined text-4xl text-primary">smart_toy</span>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">No automations yet</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400 max-w-sm">
          Create your first automation script. It will run server-side and log execution results.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
      >
        <span className="material-symbols-outlined text-base">add</span>
        Create Automation
      </button>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
      <span className="material-symbols-outlined mt-0.5 text-rose-500 dark:text-rose-400">error</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 text-xs font-bold text-rose-600 underline dark:text-rose-300"
      >
        Retry
      </button>
    </div>
  );
}

function AutomationListPanel({
  automations,
  selectedId,
  onSelect,
  onCreate,
}: {
  automations: AutomationRecord[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50 lg:w-80 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Automations
          </h2>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {automations.length} script{automations.length !== 1 ? "s" : ""} saved
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          title="New automation"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
        >
          <span className="material-symbols-outlined text-base">add</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {automations.map((auto) => {
          const isSelected = auto.id === selectedId;
          return (
            <button
              key={auto.id}
              type="button"
              onClick={() => onSelect(auto.id)}
              className={`group rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? "border-primary/60 bg-blue-50/70 shadow-sm dark:border-primary/50 dark:bg-slate-800"
                  : "border-slate-200 bg-white hover:border-primary/40 dark:border-slate-800 dark:bg-slate-900/50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <span className="material-symbols-outlined text-sm text-primary">code</span>
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {auto.name}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${
                    auto.is_enabled
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {auto.is_enabled ? "On" : "Off"}
                </span>
              </div>
              {auto.last_triggered && (
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                  Last run:{" "}
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(auto.last_triggered))}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

interface CreateModalProps {
  onClose: () => void;
  onCreated: (auto: AutomationRecord) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState("");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function handleCreate() {
    if (!name.trim()) {
      setError("Automation name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createAutomation(name.trim(), script);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create automation.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">New Automation</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Modal body */}
        <div className="flex flex-col gap-5 p-6">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Name
            </span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Soil Moisture Checker"
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Script (Python)
            </span>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-900 px-4 py-3 font-mono text-xs text-emerald-300 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700"
            />
          </label>
        </div>

        {/* Modal footer */}
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">add</span>
                Create
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main page ---
export default function AutomationPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [automations, setAutomations] = useState<AutomationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState("");

  const [triggerState, setTriggerState] = useState<TriggerState>("idle");
  const [lastResult, setLastResult] = useState<TriggerResult | null>(null);
  const [triggerError, setTriggerError] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);

  const selectedAutomation = automations.find((a) => a.id === selectedId) ?? null;
  const codeLines = (selectedAutomation?.script_code ?? "").split("\n");

  const loadAutomations = useCallback(async () => {
    setPageState("loading");
    setFetchError("");
    try {
      const list = await fetchAutomations();
      setAutomations(list);
      setPageState(list.length === 0 ? "empty" : "loaded");
      if (list.length > 0 && selectedId === null) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load automations.");
      setPageState("error");
    }
  }, [selectedId]);

  useEffect(() => {
    void loadAutomations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTrigger() {
    if (!selectedAutomation) return;
    setTriggerState("pending");
    setTriggerError("");
    setLastResult(null);
    try {
      const result = await triggerAutomation(selectedAutomation.id);
      setLastResult(result);
      setTriggerState("done");
      // Update last_triggered in local state
      setAutomations((prev) =>
        prev.map((a) =>
          a.id === selectedAutomation.id
            ? { ...a, last_triggered: result.log?.triggered_at ?? new Date().toISOString() }
            : a,
        ),
      );
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : "Trigger failed.");
      setTriggerState("done");
    }
  }

  function handleAutomationCreated(auto: AutomationRecord) {
    setAutomations((prev) => [auto, ...prev]);
    setSelectedId(auto.id);
    setPageState("loaded");
    setShowCreateModal(false);
    // Reset trigger state for the new automation
    setLastResult(null);
    setTriggerState("idle");
    setTriggerError("");
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-200">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl text-primary">smart_toy</span>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white">Automation</h1>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Server-side scripts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-base">add</span>
            New Script
          </button>
        </div>
      </header>

      {/* Loading state */}
      {pageState === "loading" && (
        <div className="flex flex-1 items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading automations…
        </div>
      )}

      {/* Error state */}
      {pageState === "error" && (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-sm">
            <ErrorBanner message={fetchError} onRetry={() => void loadAutomations()} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {pageState === "empty" && (
        <EmptyState onCreate={() => setShowCreateModal(true)} />
      )}

      {/* Loaded state — main layout */}
      {pageState === "loaded" && (
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left: automation list */}
          <AutomationListPanel
            automations={automations}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setLastResult(null);
              setTriggerState("idle");
              setTriggerError("");
            }}
            onCreate={() => setShowCreateModal(true)}
          />

          {/* Center: code viewer */}
          <section className="flex min-h-0 flex-1 flex-col border-b border-slate-200 dark:border-slate-800 lg:border-b-0 lg:border-r">
            {selectedAutomation ? (
              <>
                {/* Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {selectedAutomation.name}
                    </h2>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Python · Automation #{selectedAutomation.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTrigger()}
                    disabled={triggerState === "pending"}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {triggerState === "pending" ? (
                      <>
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Running…
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-base">play_arrow</span>
                        Run Now
                      </>
                    )}
                  </button>
                </div>

                {/* Code view */}
                <div className="flex min-h-0 flex-1 overflow-hidden bg-[#0d1117]">
                  {/* Line numbers */}
                  <div className="flex w-12 shrink-0 flex-col border-r border-slate-800 py-4 pr-3 text-right font-mono text-xs text-slate-600">
                    {codeLines.map((_, idx) => (
                      <span key={idx} className="leading-6">
                        {idx + 1}
                      </span>
                    ))}
                  </div>
                  {/* Code */}
                  <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                    <pre className="font-mono text-sm leading-6 text-slate-300">
                      <code>
                        {codeLines.map((line, idx) => (
                          <div key={idx}>{line || " "}</div>
                        ))}
                      </code>
                    </pre>
                  </div>
                </div>

                {/* Terminal output */}
                <div className="border-t border-slate-800 bg-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Execution Output
                    </span>
                    {lastResult && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${
                          lastResult.status === "success"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-rose-500/20 text-rose-300"
                        }`}
                      >
                        {lastResult.status}
                      </span>
                    )}
                  </div>
                  <div className="min-h-[80px] space-y-1 p-3 font-mono text-xs">
                    {triggerState === "idle" && !lastResult && (
                      <span className="text-slate-600">Click &ldquo;Run Now&rdquo; to execute this automation.</span>
                    )}
                    {triggerState === "pending" && (
                      <span className="animate-pulse text-amber-400">Running script…</span>
                    )}
                    {triggerError && (
                      <span className="text-rose-400">{triggerError}</span>
                    )}
                    {lastResult && (
                      <>
                        <div className="text-slate-500">
                          [{new Date(lastResult.log?.triggered_at ?? "").toLocaleTimeString()}] Execution{" "}
                          <span
                            className={lastResult.status === "success" ? "text-emerald-300" : "text-rose-300"}
                          >
                            {lastResult.status}
                          </span>
                        </div>
                        {lastResult.log?.log_output && (
                          <div className="whitespace-pre-wrap text-slate-300">
                            {lastResult.log.log_output}
                          </div>
                        )}
                        {lastResult.log?.error_message && (
                          <div className="whitespace-pre-wrap text-rose-300">
                            {lastResult.log.error_message}
                          </div>
                        )}
                        {!lastResult.log?.log_output && !lastResult.log?.error_message && (
                          <div className="text-slate-500">(No output captured)</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-400 dark:text-slate-500">
                Select an automation from the list.
              </div>
            )}
          </section>

          {/* Right: summary panel */}
          <aside className="w-full shrink-0 bg-white p-6 dark:bg-slate-900/50 lg:w-80">
            {selectedAutomation ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Details
                  </h3>
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Status</span>
                      <span
                        className={`rounded-full px-3 py-0.5 text-xs font-bold ${
                          selectedAutomation.is_enabled
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {selectedAutomation.is_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Script ID</span>
                      <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                        #{selectedAutomation.id}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Last triggered</span>
                      <span className="text-xs text-slate-700 dark:text-slate-300">
                        {selectedAutomation.last_triggered
                          ? new Intl.DateTimeFormat("en", {
                              dateStyle: "short",
                              timeStyle: "short",
                            }).format(new Date(selectedAutomation.last_triggered))
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Lines</span>
                      <span className="text-xs text-slate-700 dark:text-slate-300">
                        {codeLines.length}
                      </span>
                    </div>
                  </div>
                </div>

                {lastResult && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Last Run Result
                    </p>
                    <p
                      className={`mt-2 text-sm font-semibold ${
                        lastResult.status === "success"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {lastResult.status === "success" ? "✓ Succeeded" : "✗ Failed"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {lastResult.message}
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Scripts run server-side in a sandboxed Python environment. Execution logs are
                    persisted and observable in the database.
                  </p>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}

        {/* Create automation modal */}
        {showCreateModal && (
          <CreateModal
            onClose={() => setShowCreateModal(false)}
            onCreated={handleAutomationCreated}
          />
        )}
      </main>
    </div>
  );
}
