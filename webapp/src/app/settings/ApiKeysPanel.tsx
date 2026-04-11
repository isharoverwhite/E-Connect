/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";

import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastContext";
import {
  ApiKeyCreateResult,
  ApiKeyRecord,
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
} from "@/lib/api-keys";
import { getToken } from "@/lib/auth";
import { formatServerTimestamp } from "@/lib/server-time";

type RecentlyCreatedApiKeyState = ApiKeyCreateResult | null;

function maskApiKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "Unavailable";
  }

  if (normalized.length <= 12) {
    return `${normalized.slice(0, 4)}••••`;
  }

  return `${normalized.slice(0, 10)}••••••••••••`;
}

export function ApiKeysPanel({ timezone }: { timezone?: string | null }) {
  const { showToast } = useToast();
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionKeyId, setActionKeyId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [recentlyCreatedKey, setRecentlyCreatedKey] = useState<RecentlyCreatedApiKeyState>(null);
  const [availableSecrets, setAvailableSecrets] = useState<Record<string, string>>({});
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  async function loadApiKeys() {
    const token = getToken();
    if (!token) {
      showToast("Missing session token. Please sign in again.", "error");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchApiKeys(token);
      setApiKeys(data);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to load API keys",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  const loadApiKeysForEffect = useEffectEvent(() => {
    void loadApiKeys();
  });

  useEffect(() => {
    loadApiKeysForEffect();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLabelError("");

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setLabelError("A label is required so you can tell keys apart later.");
      return;
    }

    const token = getToken();
    if (!token) {
      showToast("Missing session token. Please sign in again.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createApiKey({ label: trimmedLabel }, token);
      setApiKeys((current) => [created, ...current]);
      setRecentlyCreatedKey(created);
      setAvailableSecrets((current) => ({ ...current, [created.key_id]: created.api_key }));
      setLabel("");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to create API key",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) {
      return;
    }

    const token = getToken();
    if (!token) {
      showToast("Missing session token. Please sign in again.", "error");
      return;
    }

    setActionKeyId(revokeTarget.key_id);
    try {
      const revoked = await revokeApiKey(revokeTarget.key_id, token);
      setApiKeys((current) =>
        current.map((entry) => (entry.key_id === revoked.key_id ? revoked : entry)),
      );
      showToast(`Revoked API key "${revoked.label}".`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to revoke API key",
        "error",
      );
    } finally {
      setActionKeyId(null);
      setRevokeTarget(null);
    }
  }

  async function handleCopyApiKey(keyId: string) {
    const rawKey = availableSecrets[keyId];
    if (!rawKey) {
      showToast("The full API key is no longer available in this session.", "warning");
      return;
    }

    try {
      await navigator.clipboard.writeText(rawKey);
      setCopiedKeyId(keyId);
      showToast("API key copied to clipboard.", "success");
    } catch {
      showToast("Failed to copy API key. Copy it manually instead.", "error");
    }
  }

  const sortedKeys = [...apiKeys].sort((left, right) => {
    if (left.is_revoked !== right.is_revoked) {
      return left.is_revoked ? 1 : -1;
    }
    return `${right.created_at ?? ""}`.localeCompare(`${left.created_at ?? ""}`);
  });

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <section className="max-w-6xl">
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Third-party access</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Create a new API key</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Each key acts as your signed-in account. Third-party tools can query device data and send control commands,
                but they still inherit your existing room and device permissions.
              </p>
            </div>
            <span className="material-icons-round rounded-2xl bg-primary/10 p-3 text-2xl text-primary">vpn_key</span>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleCreate} noValidate>
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${labelError ? "text-rose-500" : "text-slate-700 dark:text-slate-300"}`}>
                Key label
              </label>
              <input
                type="text"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  if (labelError) {
                    setLabelError("");
                  }
                }}
                className={`w-full rounded-2xl border bg-white px-4 py-3 text-slate-900 outline-none transition dark:bg-slate-900/80 dark:text-white ${
                  labelError
                    ? "border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                    : "border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700"
                }`}
                placeholder="Raycast on MacBook"
              />
              {labelError ? (
                <p className="mt-2 flex items-center text-sm font-medium text-rose-500">
                  <span className="material-icons-round mr-1 text-[18px]">error_outline</span>
                  {labelError}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Use a descriptive label per device, workstation, or integration so you can revoke the right key later.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">Request format</p>
              <p className="mt-2">
                Send the key in the normal auth header:
                <code className="ml-2 rounded bg-slate-900 px-2 py-1 text-xs text-slate-100 dark:bg-slate-800">
                  Authorization: Bearer &lt;api_key&gt;
                </code>
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <span className="material-icons-round animate-spin">refresh</span>
              ) : (
                <>
                  <span className="material-icons-round mr-2 text-[18px]">add</span>
                  Generate API key
                </>
              )}
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Scope</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">How permissions work</h2>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Account identity</p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                The API key behaves exactly like the account that created it. Admin accounts keep admin access.
                Normal users only see and control devices inside rooms they have been granted.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Safe storage</p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                The full key is shown only once right after creation. Store it in your password manager or the secret storage
                provided by your third-party app.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Revocation</p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                Revoking a key blocks future requests immediately. Existing session tokens are unaffected.
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-10 flex items-end justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Issued API keys</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage keys for Raycast extensions, scripts, and other integrations.</p>
        </div>
        <button
          onClick={() => void loadApiKeys()}
          className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="material-icons-round mr-2 text-[18px]">refresh</span>
          Refresh
        </button>
      </div>

      {sortedKeys.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="material-icons-round text-3xl">vpn_key_off</span>
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">No API keys yet</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Create the first key above when you are ready to connect a third-party tool.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50">
          <table className="w-full text-left text-sm text-slate-500 dark:text-slate-400">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
              <tr>
                <th className="px-6 py-4">Label / Prefix</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Used</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedKeys.map((apiKey) => (
                <tr
                  key={apiKey.key_id}
                  className="border-b border-slate-100 transition-colors hover:bg-slate-50/50 dark:border-slate-800/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{apiKey.label}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <code className="inline-block rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {maskApiKey(availableSecrets[apiKey.key_id] ?? apiKey.token_prefix)}
                        </code>
                        {availableSecrets[apiKey.key_id] ? (
                          <button
                            onClick={() => void handleCopyApiKey(apiKey.key_id)}
                            className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <span className="material-icons-round mr-1 text-[14px]">content_copy</span>
                            {copiedKeyId === apiKey.key_id ? "Copied" : "Copy"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                        apiKey.is_revoked
                          ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"
                          : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                      }`}
                    >
                      {apiKey.is_revoked ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {apiKey.last_used_at
                      ? formatServerTimestamp(apiKey.last_used_at, {
                          fallback: "Unknown",
                          options: {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                          timezone,
                        })
                      : "Never"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {formatServerTimestamp(apiKey.created_at, {
                      fallback: "Unknown",
                      options: {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                      timezone,
                    })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {apiKey.is_revoked ? (
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">No actions</span>
                    ) : (
                      <button
                        onClick={() => setRevokeTarget(apiKey)}
                        disabled={actionKeyId === apiKey.key_id}
                        className="inline-flex items-center rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                      >
                        {actionKeyId === apiKey.key_id ? (
                          <span className="material-icons-round animate-spin text-[18px]">refresh</span>
                        ) : (
                          <>
                            <span className="material-icons-round mr-1 text-[18px]">block</span>
                            Revoke
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentlyCreatedKey ? (
        <div className="fixed bottom-6 right-6 z-[9999] w-full max-w-lg px-4 sm:px-0">
          <div className="rounded-2xl border border-emerald-200 bg-white/95 p-5 shadow-2xl backdrop-blur-md dark:border-emerald-500/30 dark:bg-slate-900/95">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                <span className="material-icons-round text-[20px]">check_circle</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">API key created successfully</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Copy it now. When you close this toast, the table keeps only a masked preview.
                    </p>
                  </div>
                  <button
                    onClick={() => setRecentlyCreatedKey(null)}
                    className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                    aria-label="Dismiss API key toast"
                  >
                    <span className="material-icons-round text-[18px]">close</span>
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Preview
                  </p>
                  <code className="mt-2 block break-all rounded-lg bg-slate-900 px-3 py-3 text-xs text-slate-100 dark:bg-slate-800">
                    {recentlyCreatedKey.api_key}
                  </code>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-3">
                  <button
                    onClick={() => void handleCopyApiKey(recentlyCreatedKey.key_id)}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600"
                  >
                    {copiedKeyId === recentlyCreatedKey.key_id ? "Copied" : "Copy key"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        isOpen={!!revokeTarget}
        title="Revoke API key"
        message={`Are you sure you want to revoke "${revokeTarget?.label}"? Third-party clients using it will stop working immediately.`}
        confirmText="Revoke key"
        cancelText="Cancel"
        type="danger"
        isLoading={!!actionKeyId}
        onConfirm={() => void handleConfirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </section>
  );
}
