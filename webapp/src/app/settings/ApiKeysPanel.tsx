/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";

import ConfirmModal from "@/components/ConfirmModal";
import { useLanguage } from "@/components/LanguageContext";
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

function maskApiKey(value: string, t: (key: string) => string): string {
  const normalized = value.trim();
  if (!normalized) {
    return t("settings.apikeys.unavailable");
  }

  if (normalized.length <= 12) {
    return `${normalized.slice(0, 4)}••••`;
  }

  return `${normalized.slice(0, 10)}••••••••••••`;
}

export function ApiKeysPanel({ timezone }: { timezone?: string | null }) {
  const { t } = useLanguage();
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
      showToast(t("settings.error.missing_token"), "error");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchApiKeys(token);
      setApiKeys(data);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("settings.error.load_api_keys"),
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
      setLabelError(t("settings.apikeys.key_label_req"));
      return;
    }

    const token = getToken();
    if (!token) {
      showToast(t("settings.error.missing_token"), "error");
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
        error instanceof Error ? error.message : t("settings.error.create_api_key"),
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
      showToast(t("settings.error.missing_token"), "error");
      return;
    }

    setActionKeyId(revokeTarget.key_id);
    try {
      const revoked = await revokeApiKey(revokeTarget.key_id, token);
      setApiKeys((current) =>
        current.map((entry) => (entry.key_id === revoked.key_id ? revoked : entry)),
      );
      showToast(t("settings.toast.api_key_revoked").replace("{name}", revoked.label), "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("settings.error.revoke_api_key"),
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
      showToast(t("settings.toast.api_key_missing"), "warning");
      return;
    }

    try {
      await navigator.clipboard.writeText(rawKey);
      setCopiedKeyId(keyId);
      showToast(t("settings.toast.api_key_copied"), "success");
    } catch {
      showToast(t("settings.error.copy_api_key"), "error");
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
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.apikeys.third_party_access")}</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{t("settings.apikeys.create_title")}</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t("settings.apikeys.create_desc")}
              </p>
            </div>
            <span className="material-icons-round rounded-2xl bg-primary/10 p-3 text-2xl text-primary">vpn_key</span>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleCreate} noValidate>
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${labelError ? "text-rose-500" : "text-slate-700 dark:text-slate-300"}`}>
                {t("settings.apikeys.key_label")}
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
                placeholder={t("settings.apikeys.key_label_placeholder")}
              />
              {labelError ? (
                <p className="mt-2 flex items-center text-sm font-medium text-rose-500">
                  <span className="material-icons-round mr-1 text-[18px]">error_outline</span>
                  {labelError}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {t("settings.apikeys.key_label_desc")}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">{t("settings.apikeys.request_format")}</p>
              <p className="mt-2">
                {t("settings.apikeys.request_format_desc")}
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3.5 dark:bg-slate-950">
                <code className="flex items-center text-xs font-mono text-slate-300">
                  <span className="text-blue-400 mr-2">Authorization:</span>
                  <span className="text-emerald-400">Bearer &lt;api_key&gt;</span>
                </code>
              </div>
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
                  {t("settings.apikeys.btn_generate")}
                </>
              )}
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.apikeys.scope_title")}</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{t("settings.apikeys.how_permissions_work")}</h2>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.apikeys.account_identity")}</p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                {t("settings.apikeys.account_identity_desc")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.apikeys.safe_storage")}</p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                {t("settings.apikeys.safe_storage_desc")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.apikeys.revocation")}</p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                {t("settings.apikeys.revocation_desc")}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-10 flex items-end justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t("settings.apikeys.issued_title")}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("settings.apikeys.issued_desc")}</p>
        </div>
        <button
          onClick={() => void loadApiKeys()}
          className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="material-icons-round mr-2 text-[18px]">refresh</span>
          {t("settings.apikeys.btn_refresh")}
        </button>
      </div>

      {sortedKeys.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="material-icons-round text-3xl">vpn_key_off</span>
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">{t("settings.apikeys.empty_title")}</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t("settings.apikeys.empty_desc")}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50">
          <table className="w-full text-left text-sm text-slate-500 dark:text-slate-400">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
              <tr>
                <th className="px-6 py-4">{t("settings.apikeys.th_label")}</th>
                <th className="px-6 py-4">{t("settings.apikeys.th_status")}</th>
                <th className="px-6 py-4">{t("settings.apikeys.th_last_used")}</th>
                <th className="px-6 py-4">{t("settings.apikeys.th_created")}</th>
                <th className="px-6 py-4 text-right">{t("settings.apikeys.th_actions")}</th>
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
                          {maskApiKey(availableSecrets[apiKey.key_id] ?? apiKey.token_prefix, t)}
                        </code>
                        {availableSecrets[apiKey.key_id] ? (
                          <button
                            onClick={() => void handleCopyApiKey(apiKey.key_id)}
                            className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <span className="material-icons-round mr-1 text-[14px]">content_copy</span>
                            {copiedKeyId === apiKey.key_id ? t("settings.apikeys.btn_copied") : t("settings.apikeys.btn_copy")}
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
                      {apiKey.is_revoked ? t("settings.apikeys.status_revoked") : t("settings.apikeys.status_active")}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {apiKey.last_used_at
                      ? formatServerTimestamp(apiKey.last_used_at, {
                          fallback: t("settings.apikeys.unknown"),
                          options: {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                          timezone,
                        })
                      : t("settings.apikeys.never")}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {formatServerTimestamp(apiKey.created_at, {
                      fallback: t("settings.apikeys.unknown"),
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
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t("settings.apikeys.no_actions")}</span>
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
                            {t("settings.apikeys.btn_revoke")}
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
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{t("settings.apikeys.toast_success_title")}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {t("settings.apikeys.toast_success_desc")}
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
                    {t("settings.apikeys.preview")}
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
                    {copiedKeyId === recentlyCreatedKey.key_id ? t("settings.apikeys.btn_copied") : t("settings.apikeys.btn_copy_key")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        isOpen={!!revokeTarget}
        title={t("settings.apikeys.modal_revoke_title")}
        message={t("settings.apikeys.modal_revoke_desc").replace("{name}", revokeTarget?.label ?? "")}
        confirmText={t("settings.apikeys.modal_btn_revoke")}
        cancelText={t("settings.apikeys.modal_btn_cancel")}
        type="danger"
        isLoading={!!actionKeyId}
        onConfirm={() => void handleConfirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </section>
  );
}
