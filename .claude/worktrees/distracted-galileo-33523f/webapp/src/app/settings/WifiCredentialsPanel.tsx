/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { getToken } from "@/lib/auth";
import {
  WifiCredentialRecord,
  createWifiCredential,
  deleteWifiCredential,
  fetchWifiCredentials,
  revealWifiCredentialPassword,
  updateWifiCredential,
} from "@/lib/wifi-credentials";
import { useToast } from "@/components/ToastContext";
import ConfirmModal from "@/components/ConfirmModal";
import { formatServerTimestamp } from "@/lib/server-time";
import { useLanguage } from "@/components/LanguageContext";

interface EditingState {
  id: number;
  ssid: string;
  password: string;
}

export function WifiCredentialsPanel({ timezone }: { timezone?: string | null }) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [credentials, setCredentials] = useState<WifiCredentialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [createSsid, setCreateSsid] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [revealTarget, setRevealTarget] = useState<WifiCredentialRecord | null>(
    null,
  );
  const [revealedPasswords, setRevealedPasswords] = useState<
    Record<number, string>
  >({});
  const [revealAccountPassword, setRevealAccountPassword] = useState("");
  const [revealError, setRevealError] = useState("");
  const [revealShakeKey, setRevealShakeKey] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<WifiCredentialRecord | null>(null);

  async function loadCredentials() {
    const token = getToken();
    if (!token) {
      showToast(t("settings.error.missing_token"), "error");
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const data = await fetchWifiCredentials(token);
      setCredentials(data);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : t("settings.error.load_wifi"),
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCredentials();
  }, []);

  const sortedCredentials = useMemo(
    () =>
      [...credentials].sort((left, right) =>
        left.ssid.localeCompare(right.ssid),
      ),
    [credentials],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateErrors({});

    const nextErrors: Record<string, string> = {};
    if (!createSsid.trim()) {
      nextErrors.ssid = t("settings.error.ssid_required");
    }
    if (!createPassword) {
      nextErrors.password = t("settings.error.password_required");
    }
    if (Object.keys(nextErrors).length > 0) {
      setCreateErrors(nextErrors);
      return;
    }

    const token = getToken();
    if (!token) {
      showToast(t("settings.error.missing_token"), "error");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createWifiCredential(
        { ssid: createSsid.trim(), password: createPassword },
        token,
      );
      setCredentials((current) => [...current, created]);
      setCreateSsid("");
      setCreatePassword("");
      showToast(t("settings.toast.wifi_saved").replace("{ssid}", created.ssid), "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : t("settings.error.save_wifi"),
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing) {
      return;
    }

    const token = getToken();
    if (!token) {
      showToast(t("settings.error.missing_token"), "error");
      return;
    }

    if (!editing.ssid.trim() || !editing.password) {
      showToast(t("settings.error.ssid_password_required"), "error");
      return;
    }

    setActionId(editing.id);

    try {
      const updated = await updateWifiCredential(
        editing.id,
        { ssid: editing.ssid.trim(), password: editing.password },
        token,
      );
      setCredentials((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setEditing(null);
      setShowEditPassword(false);
      showToast(t("settings.toast.wifi_updated").replace("{ssid}", updated.ssid), "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : t("settings.error.update_wifi"),
        "error"
      );
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(target: WifiCredentialRecord) {
    if (target.usage_count > 0) {
      showToast(
        t("settings.error.delete_wifi_in_use")
          .replace("{ssid}", target.ssid)
          .replace("{count}", target.usage_count.toString()),
        "error"
      );
      return;
    }

    setConfirmDeleteTarget(target);
  }

  async function executeDelete() {
    if (!confirmDeleteTarget) return;

    const target = confirmDeleteTarget;
    setConfirmDeleteTarget(null);

    const token = getToken();
    if (!token) {
      showToast(t("settings.error.missing_token"), "error");
      return;
    }

    setActionId(target.id);

    try {
      await deleteWifiCredential(target.id, token);
      setCredentials((current) =>
        current.filter((entry) => entry.id !== target.id),
      );
      showToast(t("settings.toast.wifi_deleted").replace("{ssid}", target.ssid), "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : t("settings.error.delete_wifi"),
        "error"
      );
    } finally {
      setActionId(null);
    }
  }

  async function handleReveal() {
    if (!revealTarget) {
      return;
    }

    if (!revealAccountPassword.trim()) {
      setRevealError(t("settings.error.reveal_password_req"));
      return;
    }

    const token = getToken();
    if (!token) {
      setRevealError(t("settings.error.missing_token"));
      return;
    }

    setRevealing(true);
    setRevealError("");

    try {
      const secret = await revealWifiCredentialPassword(
        revealTarget.id,
        revealAccountPassword,
        token,
      );
      setRevealedPasswords((prev) => ({
        ...prev,
        [revealTarget.id]: secret.password,
      }));
      closeRevealModal();
    } catch (nextError) {
      void nextError; // Ignore the actual error message
      setRevealError(t("settings.error.reveal_password_incorrect"));
      setRevealShakeKey((prev) => prev + 1);
    } finally {
      setRevealing(false);
    }
  }

  function closeRevealModal() {
    if (revealing) {
      return;
    }
    setRevealTarget(null);
    setRevealAccountPassword("");
    setRevealError("");
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <section className="max-w-5xl">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xl font-bold dark:text-white text-slate-900">
            {t("settings.wifi.title")}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("settings.wifi.desc")}
          </p>
        </div>
      </div>



      <form
        className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl mb-10"
        onSubmit={handleCreate}
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {t("settings.wifi.form.ssid")}
          </label>
          <input
            className={`w-full bg-white dark:bg-slate-800 border rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white ${
              createErrors.ssid
                ? "border-rose-400"
                : "border-slate-200 dark:border-slate-700"
            }`}
            placeholder={t("settings.wifi.form.ssid_placeholder")}
            value={createSsid}
            onChange={(event) => setCreateSsid(event.target.value)}
          />
          {createErrors.ssid ? (
            <p className="mt-1 text-sm text-rose-500 flex items-center gap-1">
              <span className="material-icons-round text-base">
                error_outline
              </span>{" "}
              {createErrors.ssid}
            </p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {t("settings.wifi.form.password")}
          </label>
          <div className="relative">
            <input
              className={`w-full bg-white dark:bg-slate-800 border rounded-lg pl-4 pr-11 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white ${
                createErrors.password
                  ? "border-rose-400"
                  : "border-slate-200 dark:border-slate-700"
              }`}
              placeholder={t("settings.wifi.form.password_placeholder")}
              type={showCreatePassword ? "text" : "password"}
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
              onClick={() => setShowCreatePassword((prev) => !prev)}
              aria-label={
                showCreatePassword ? t("settings.wifi.table.hide_password") : t("settings.wifi.table.reveal_password")
              }
            >
              <span className="material-icons-round text-[20px]">
                {showCreatePassword ? "visibility_off" : "visibility"}
              </span>
            </button>
          </div>
          {createErrors.password ? (
            <p className="mt-1 text-sm text-rose-500 flex items-center gap-1">
              <span className="material-icons-round text-base">
                error_outline
              </span>{" "}
              {createErrors.password}
            </p>
          ) : null}
        </div>

        <div className="flex items-end">
          <button
            className="w-full md:w-auto bg-primary hover:bg-blue-600 text-white font-semibold py-2.5 px-6 rounded-lg text-sm shadow-lg shadow-primary/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? t("settings.wifi.form.btn_saving") : t("settings.wifi.form.btn_add")}
          </button>
        </div>
      </form>

      <div className="flex justify-between items-end mb-6">
        <div>
          <h3 className="text-xl font-bold dark:text-white text-slate-900">
            {t("settings.wifi.saved_title")}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("settings.wifi.saved_desc")}
          </p>
        </div>
        <div className="text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700">
          {sortedCredentials.length === 1 
            ? t("settings.wifi.network_count_single") 
            : t("settings.wifi.network_count_plural").replace("{count}", sortedCredentials.length.toString())}
        </div>
      </div>

      {sortedCredentials.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="material-icons-round text-3xl">wifi</span>
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
            {t("settings.wifi.empty_title")}
          </h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t("settings.wifi.empty_desc")}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto w-full">
          <table className="w-full text-left text-sm text-slate-500 dark:text-slate-400">
            <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th scope="col" className="px-6 py-4">
                  {t("settings.wifi.table.ssid_usage")}
                </th>
                <th scope="col" className="px-6 py-4">
                  {t("settings.wifi.table.password_status")}
                </th>
                <th scope="col" className="px-6 py-4">
                  {t("settings.wifi.table.last_updated")}
                </th>
                <th scope="col" className="px-6 py-4 text-right">
                  {t("settings.wifi.table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedCredentials.map((credential) => {
                const isEditing = editing?.id === credential.id;

                return (
                  <tr
                    key={credential.id}
                    className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white"
                          value={editing.ssid}
                          onChange={(event) =>
                            setEditing((current) =>
                              current
                                ? { ...current, ssid: event.target.value }
                                : current,
                            )
                          }
                        />
                      ) : (
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white text-base">
                            {credential.ssid}
                          </div>
                          <div className="text-xs mt-1 text-slate-500">
                            {credential.usage_count === 1
                              ? t("settings.wifi.table.usage_single")
                              : t("settings.wifi.table.usage_plural").replace("{count}", credential.usage_count.toString())}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <div className="relative">
                          <input
                            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-3 pr-10 py-2 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white"
                            type={showEditPassword ? "text" : "password"}
                            value={editing.password}
                            onChange={(event) =>
                              setEditing((current) =>
                                current
                                  ? { ...current, password: event.target.value }
                                  : current,
                              )
                            }
                          />
                          <button
                            type="button"
                            className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                            onClick={() => setShowEditPassword((prev) => !prev)}
                            aria-label={
                              showEditPassword
                                ? t("settings.wifi.table.hide_password")
                                : t("settings.wifi.table.reveal_password")
                            }
                          >
                            <span className="material-icons-round text-[18px]">
                              {showEditPassword
                                ? "visibility_off"
                                : "visibility"}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`font-mono inline-block px-2 py-1 rounded transition-colors ${revealedPasswords[credential.id] ? "text-slate-900 dark:text-emerald-400 bg-white dark:bg-slate-800" : "text-slate-500 bg-slate-100 dark:bg-slate-800"}`}
                        >
                          {revealedPasswords[credential.id] ||
                            credential.masked_password}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {credential.updated_at
                        ? formatServerTimestamp(credential.updated_at, {
                            fallback: t("settings.wifi.recently"),
                            options: {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                            timezone,
                          })
                        : t("settings.wifi.recently")}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => void handleSaveEdit()}
                            disabled={actionId === credential.id}
                            className="text-white bg-emerald-500 hover:bg-emerald-600 font-medium rounded-lg text-sm px-3 py-2 transition-colors disabled:opacity-50"
                          >
                            {t("settings.wifi.table.btn_save")}
                          </button>
                          <button
                            onClick={() => {
                              setEditing(null);
                              setShowEditPassword(false);
                            }}
                            className="text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium rounded-lg text-sm px-3 py-2 transition-colors"
                          >
                            {t("settings.wifi.table.btn_cancel")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <div className="relative group flex items-center justify-center">
                            <button
                              onClick={() => {
                                if (revealedPasswords[credential.id]) {
                                  setRevealedPasswords((prev) => {
                                    const next = { ...prev };
                                    delete next[credential.id];
                                    return next;
                                  });
                                } else {
                                  setRevealTarget(credential);
                                  setRevealAccountPassword("");
                                  setRevealError("");
                                }
                              }}
                              className="text-primary hover:text-blue-700 dark:hover:text-blue-400 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <span className="material-icons-round text-[20px]">
                                {revealedPasswords[credential.id]
                                  ? "visibility_off"
                                  : "visibility"}
                              </span>
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-xs font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                              {revealedPasswords[credential.id]
                                ? t("settings.wifi.table.hide_password")
                                : t("settings.wifi.table.reveal_password")}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                          </div>
                          <div className="relative group flex items-center justify-center">
                            <button
                              onClick={() => {
                                setEditing({
                                  id: credential.id,
                                  ssid: credential.ssid,
                                  password: "",
                                });
                                setShowEditPassword(false);
                              }}
                              className="text-slate-500 hover:text-slate-900 dark:hover:text-white p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <span className="material-icons-round text-[20px]">
                                edit
                              </span>
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-xs font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                              {t("settings.wifi.table.edit_network")}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                          </div>
                          <div className="relative group flex items-center justify-center">
                            <button
                              onClick={() => void handleDelete(credential)}
                              disabled={
                                actionId === credential.id ||
                                credential.usage_count > 0
                              }
                              className="text-rose-500 hover:text-rose-700 p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span className="material-icons-round text-[20px]">
                                delete
                              </span>
                            </button>
                            <div className="absolute bottom-full right-0 mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-xs font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                              {credential.usage_count > 0
                                ? t("settings.wifi.table.cannot_delete")
                                : t("settings.wifi.table.delete_network")}
                              <div className="absolute top-full right-3 border-4 border-transparent border-t-slate-800"></div>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {revealTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {t("settings.wifi.modal_reveal.title")}
              </h3>
              <button
                onClick={closeRevealModal}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              >
                <span className="material-icons-round">close</span>
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              {t("settings.wifi.modal_reveal.desc")}
              <strong className="text-slate-700 dark:text-slate-300">
                {revealTarget.ssid}
              </strong>
              .
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleReveal();
              }}
            >
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t("settings.wifi.modal_reveal.account_password")}
                </label>
                <input
                  key={revealShakeKey}
                  autoFocus
                  autoComplete="current-password"
                  type="password"
                  className={`w-full bg-slate-50 dark:bg-slate-800 border rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none transition-shadow ${
                    revealError
                      ? "border-rose-500 dark:border-rose-500 animate-shake focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                      : "border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-primary focus:border-primary"
                  }`}
                  value={revealAccountPassword}
                  onChange={(event) => {
                    setRevealAccountPassword(event.target.value);
                    if (revealError) setRevealError("");
                  }}
                />
              </div>

              {revealError ? (
                <div className="mt-4 mb-4 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-[#251016] px-4 py-3 text-sm flex gap-3">
                  <span className="material-icons-round text-base text-rose-500 flex-shrink-0 mt-0.5">
                    error_outline
                  </span>
                  <p className="text-rose-700 dark:text-rose-300 leading-relaxed">
                    {revealError}
                  </p>
                </div>
              ) : null}

              <div className="flex gap-3 justify-end mt-8">
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors"
                  onClick={closeRevealModal}
                >
                  {t("settings.wifi.modal_reveal.btn_cancel")}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                  disabled={revealing}
                >
                  {revealing ? t("settings.wifi.modal_reveal.btn_verifying") : t("settings.wifi.modal_reveal.btn_reveal")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        isOpen={!!confirmDeleteTarget}
        title={t("settings.wifi.modal_delete.title")}
        message={t("settings.wifi.modal_delete.desc").replace("{ssid}", confirmDeleteTarget?.ssid || "")}
        confirmText={t("settings.wifi.modal_delete.btn_delete")}
        cancelText={t("settings.wifi.modal_delete.btn_cancel")}
        type="danger"
        isLoading={!!actionId}
        onConfirm={() => void executeDelete()}
        onCancel={() => setConfirmDeleteTarget(null)}
      />
    </section>
  );
}
