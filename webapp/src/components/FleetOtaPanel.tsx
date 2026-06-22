// Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

"use client";

import { useState } from "react";
import { batchOTA, BatchOtaResult } from "@/lib/api";
import { DeviceConfig } from "@/types/device";

interface FleetOtaPanelProps {
    devices: DeviceConfig[];
    onClose: () => void;
}

export function FleetOtaPanel({ devices, onClose }: FleetOtaPanelProps) {
    const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
    const [isPushing, setIsPushing] = useState(false);
    const [results, setResults] = useState<BatchOtaResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Only show DIY devices that have a provisioning project (eligible for OTA)
    const eligibleDevices = devices.filter((d) => Boolean(d.provisioning_project_id));

    const toggleDevice = (id: string) => {
        setSelectedDeviceIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleAll = () => {
        if (selectedDeviceIds.length === eligibleDevices.length) {
            setSelectedDeviceIds([]);
        } else {
            setSelectedDeviceIds(eligibleDevices.map((d) => d.device_id));
        }
    };

    const pushFleetOta = async () => {
        if (selectedDeviceIds.length === 0) return;
        setIsPushing(true);
        setError(null);
        setResults(null);
        try {
            const data = await batchOTA(selectedDeviceIds);
            setResults(data.results);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to trigger batch OTA");
        } finally {
            setIsPushing(false);
        }
    };

    const statusIcon = (status: BatchOtaResult["status"]) => {
        switch (status) {
            case "triggered":
                return <span className="material-icons-round text-green-500 text-base">check_circle</span>;
            case "already_queued":
                return <span className="material-icons-round text-blue-500 text-base">pending</span>;
            case "not_found":
            case "error":
                return <span className="material-icons-round text-red-500 text-base">error</span>;
            default:
                return null;
        }
    };

    const statusLabel = (status: BatchOtaResult["status"]) => {
        switch (status) {
            case "triggered": return "Queued";
            case "already_queued": return "Already building";
            case "not_found": return "Not found";
            case "error": return "Error";
            default: return status;
        }
    };

    const deviceName = (deviceId: string) => {
        const found = devices.find((d) => d.device_id === deviceId);
        return found?.name ?? deviceId;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={() => { if (!isPushing) onClose(); }}
            />
            <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                            <span className="material-icons-round text-lg text-blue-600 dark:text-blue-400">system_update_alt</span>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Fleet OTA</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Push firmware update to multiple devices</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isPushing}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                        <span className="material-icons-round text-xl">close</span>
                    </button>
                </div>

                {/* Results view */}
                {results ? (
                    <div className="px-6 py-5">
                        <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                            OTA Results — {results.length} device{results.length !== 1 ? "s" : ""}
                        </h4>
                        <div className="max-h-72 overflow-y-auto space-y-2">
                            {results.map((r) => (
                                <div
                                    key={r.device_id}
                                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/50"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{deviceName(r.device_id)}</p>
                                        {r.message && (
                                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{r.message}</p>
                                        )}
                                        {r.job_id && (
                                            <p className="font-mono text-xs text-slate-400 truncate">Job: {r.job_id}</p>
                                        )}
                                    </div>
                                    <div className="ml-3 flex shrink-0 items-center gap-1.5">
                                        {statusIcon(r.status)}
                                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{statusLabel(r.status)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-5 flex justify-end">
                            <button
                                onClick={onClose}
                                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Device list */}
                        <div className="px-6 py-4">
                            {eligibleDevices.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
                                    <span className="material-icons-round text-3xl text-slate-300">hardware</span>
                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No DIY devices eligible for OTA</p>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-3 flex items-center justify-between">
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {selectedDeviceIds.length} of {eligibleDevices.length} selected
                                        </p>
                                        <button
                                            onClick={toggleAll}
                                            className="text-xs font-medium text-primary hover:underline"
                                        >
                                            {selectedDeviceIds.length === eligibleDevices.length ? "Deselect all" : "Select all"}
                                        </button>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto space-y-2">
                                        {eligibleDevices.map((device) => {
                                            const isSelected = selectedDeviceIds.includes(device.device_id);
                                            const isOnline = device.conn_status === "online";
                                            return (
                                                <button
                                                    key={device.device_id}
                                                    type="button"
                                                    onClick={() => toggleDevice(device.device_id)}
                                                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                                                        isSelected
                                                            ? "border-primary/40 bg-primary/5 dark:border-primary/30 dark:bg-primary/10"
                                                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800"
                                                    }`}
                                                >
                                                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                                        isSelected
                                                            ? "border-primary bg-primary"
                                                            : "border-slate-300 dark:border-slate-600"
                                                    }`}>
                                                        {isSelected && (
                                                            <span className="material-icons-round text-[12px] text-white">check</span>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{device.name}</p>
                                                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                                            <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-500" : "bg-slate-400"}`} />
                                                            {isOnline ? "Online" : "Offline"}
                                                            {device.firmware_revision && (
                                                                <span className="ml-1 font-mono">· {device.firmware_revision}</span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            {error && (
                                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 dark:border-slate-800">
                            <button
                                onClick={onClose}
                                disabled={isPushing}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={pushFleetOta}
                                disabled={selectedDeviceIds.length === 0 || isPushing}
                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isPushing ? (
                                    <span className="material-icons-round animate-spin text-base">refresh</span>
                                ) : (
                                    <span className="material-icons-round text-base">rocket_launch</span>
                                )}
                                {isPushing
                                    ? "Pushing..."
                                    : `Push OTA to ${selectedDeviceIds.length} device${selectedDeviceIds.length !== 1 ? "s" : ""}`}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
