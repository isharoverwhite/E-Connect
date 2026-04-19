/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import React from "react";
import type { DeviceConfig } from "@/types/device";
import type { useOtaUpdate } from "@/hooks/useOtaUpdate";

export interface OtaUpdateModalProps {
  device: DeviceConfig | null;
  otaState: ReturnType<typeof useOtaUpdate>;
  onClose: () => void;
}

export function OtaUpdateModal({ device, otaState, onClose }: OtaUpdateModalProps) {
  const {
    jobId,
    jobStatus,
    jobError,
    expectedFirmwareVersion,
    otaModalOpen,
    setOtaModalOpen,
    sendingOta,
    otaPassword,
    setOtaPassword,
    otaActionError,
    setOtaActionError,
    boardOnlineAfterOta,
    statusMessage,
    handleInitiateOta,
  } = otaState;

  if (!otaModalOpen) return null;

  const canInitiateOta = jobStatus === "artifact_ready" || jobStatus === "flash_failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Firmware rebuild and OTA update
            </h2>
            <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
              This build is staging the firmware. Wait for the firmware artifact, then
              trigger OTA for this exact build job. The committed config stays unchanged until
              the board reports the new firmware.
            </p>
          </div>
          {jobStatus !== "building" && jobStatus !== "flashing" && (
            <button
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={() => {
                setOtaModalOpen(false);
                setOtaPassword("");
                setOtaActionError(null);
                onClose();
              }}
              type="button"
            >
              <span className="material-icons-round">close</span>
            </button>
          )}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Build job
            </p>
            <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
              {jobId ?? "pending"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Current status
            </p>
            <p className="mt-2 font-mono text-sm text-slate-700 dark:text-slate-200">
              {jobStatus ?? "queued"}
            </p>
          </div>
        </div>

        {(expectedFirmwareVersion || device?.firmware_version) && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Board-reported Firmware
              </p>
              <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                {device?.firmware_version ?? "unknown"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Target Firmware
              </p>
              <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                {expectedFirmwareVersion ?? "pending"}
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-4">
          {jobStatus === "queued" && (
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-blue-500">
                <span className="material-icons-round animate-spin text-[20px] leading-none">autorenew</span>
              </span>
              <p className="min-w-0 flex-1 leading-6 text-left">
                Build job queued. The server will start compiling shortly.
              </p>
            </div>
          )}

          {jobStatus === "building" && (
            <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
              <span className="material-icons-round animate-spin">settings</span>
              Building new firmware...
            </div>
          )}

          {jobStatus === "artifact_ready" && (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
              <span className="material-icons-round">task_alt</span>
              Artifact ready. You can now push the OTA update to the device.
            </div>
          )}

          {jobStatus === "flashing" && (
            <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
              <span className="material-icons-round animate-bounce">system_update_alt</span>
              OTA command sent. The device should be downloading and flashing the new firmware.
            </div>
          )}

          {jobStatus === "flashed" && (
            boardOnlineAfterOta ? (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
                  <span className="material-icons-round text-[20px] leading-none">task_alt</span>
                </span>
                <p className="min-w-0 flex-1 leading-6 text-left">
                  The board is back online with the new firmware!
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
                  <span className="material-icons-round animate-spin text-[20px] leading-none">autorenew</span>
                </span>
                <p className="min-w-0 flex-1 leading-6 text-left">
                  {statusMessage || "OTA finished. Waiting for the board to reconnect..."}
                </p>
              </div>
            )
          )}

          {jobStatus === "build_failed" && (
            <div className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="flex items-center gap-3 font-semibold">
                <span className="material-icons-round">error</span>
                Firmware rebuild failed
              </div>
              <p className="pl-9 text-rose-900 dark:text-rose-100">
                Review the build error before retrying.
              </p>
              {jobError && (
                <div className="ml-9 mt-2 rounded bg-white/50 p-3 font-mono text-xs dark:bg-slate-900/50 break-words">
                  <span className="mb-1 block font-bold uppercase tracking-wider text-rose-700/70 dark:text-rose-400">
                    Error Details
                  </span>
                  <span>{jobError}</span>
                </div>
              )}
            </div>
          )}

          {jobStatus === "flash_failed" && (
            <div className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <div className="flex items-center gap-3 font-semibold">
                <span className="material-icons-round">warning</span>
                OTA update failed
              </div>
              <p className="pl-9 text-rose-900 dark:text-rose-100">
                The board failed to update over the air. Check the board power and network, then retry this exact artifact or rebuild if the config changed.
              </p>
              {jobError && (
                <div className="ml-9 mt-2 rounded bg-white/50 p-3 font-mono text-xs dark:bg-slate-900/50 break-words">
                  <span className="mb-1 block font-bold uppercase tracking-wider text-rose-700/70 dark:text-rose-400">
                    Error Reason
                  </span>
                  <span>{jobError}</span>
                </div>
              )}
            </div>
          )}

          {jobError && jobStatus !== "build_failed" && jobStatus !== "flash_failed" && (
            <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <span className="material-icons-round">error</span>
              <span className="font-mono text-xs break-words">{jobError}</span>
            </div>
          )}

          {canInitiateOta && (
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                void handleInitiateOta();
              }}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                OTA authorization
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Enter your account password before the dashboard sends the OTA update command to the board.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Account password
                <div className="mt-2 flex gap-3">
                  <input
                    autoComplete="current-password"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={sendingOta}
                    onChange={(event) => {
                      setOtaPassword(event.target.value);
                      if (otaActionError) {
                        setOtaActionError(null);
                      }
                    }}
                    placeholder="Enter your password"
                    type="password"
                    value={otaPassword}
                  />
                  <button
                    disabled={sendingOta || otaPassword.length < 8}
                    className="shrink-0 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    type="submit"
                  >
                    {sendingOta ? "Sending OTA..." : "Install OTA"}
                  </button>
                </div>
              </label>
            </form>
          )}

          {otaActionError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              {otaActionError}
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {jobStatus !== "building" && jobStatus !== "flashing" && (
            <button
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              onClick={() => {
                setOtaModalOpen(false);
                setOtaPassword("");
                setOtaActionError(null);
                onClose();
              }}
              type="button"
            >
              {boardOnlineAfterOta ? "Done" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
