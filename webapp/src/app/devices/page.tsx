"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import Sidebar from "@/components/Sidebar";
import { fetchDevices, deleteDevice } from "@/lib/api";
import { getActivePinConfigurations } from "@/lib/device-config";
import { DeviceConfig, DeviceDirectoryEntry } from "@/types/device";
import { useToast } from "@/components/ToastContext";
import ConfirmModal from "@/components/ConfirmModal";
import { useWebSocket } from "@/hooks/useWebSocket";

function readTrimmedString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export default function DevicesPage() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const [devices, setDevices] = useState<DeviceDirectoryEntry[]>([]);
    const [pairingRequests, setPairingRequests] = useState<DeviceConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        deviceId: string;
        deviceName: string;
    }>({ isOpen: false, deviceId: "", deviceName: "" });
    
    const isAdmin = user?.account_type === "admin";
    const primaryActionButtonClassName =
        "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-600 hover:shadow-lg";
    const secondaryActionButtonClassName =
        "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";

    async function loadDevices() {
        const [data, pending] = await Promise.all([
            fetchDevices(),
            isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([])
        ]);
        setDevices(data);
        setPairingRequests(pending as DeviceConfig[]);
        setLoading(false);
    }



    useEffect(() => {
        let cancelled = false;

        void Promise.all([
            fetchDevices(),
            isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([])
        ]).then(([data, pending]) => {
            if (cancelled) {
                return;
            }
            setDevices(data);
            setPairingRequests(pending as DeviceConfig[]);
            setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [isAdmin]);

    const { isConnected } = useWebSocket((event) => {
        if (event.type === "pairing_requested" || event.type === "pairing_queue_updated") {
            void loadDevices();
            return;
        }

        if (!("device_id" in event)) {
            return;
        }

        if (
            (event.type === "device_online" || event.type === "device_state") &&
            !devices.some((device) => device.device_id === event.device_id)
        ) {
            void loadDevices();
            return;
        }

        setDevices((prev) => {
            return prev.map((device) => {
                if (device.device_id === event.device_id) {
                    if (event.type === "device_online") {
                        return { ...device, conn_status: "online", last_seen: event.payload?.reported_at || new Date().toISOString() };
                    }
                    if (event.type === "device_offline") {
                        return { ...device, conn_status: "offline" };
                    }
                    if (event.type === "device_state") {
                        const reportedAt = readTrimmedString(event.payload?.["reported_at"]) || new Date().toISOString();
                        const reportedIp = readTrimmedString(event.payload?.["ip_address"]);
                        const reportedFirmwareRevision = readTrimmedString(event.payload?.["firmware_revision"]);
                        const reportedFirmwareVersion = readTrimmedString(event.payload?.["firmware_version"]);
                        const currentIpAddress = "ip_address" in device ? device.ip_address : undefined;
                        const currentFirmwareRevision = "firmware_revision" in device ? device.firmware_revision : undefined;
                        const currentFirmwareVersion = "firmware_version" in device ? device.firmware_version : undefined;

                        return {
                            ...device,
                            conn_status: "online",
                            last_seen: reportedAt,
                            ip_address: reportedIp || currentIpAddress,
                            firmware_revision: reportedFirmwareRevision || currentFirmwareRevision,
                            firmware_version: reportedFirmwareVersion || currentFirmwareVersion,
                        };
                    }
                }
                return device;
            });
        });
    });

    useEffect(() => {
        if (!isConnected) {
            return;
        }

        let cancelled = false;
        const timeoutId = window.setTimeout(() => {
            void Promise.all([
                fetchDevices(),
                isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([])
            ]).then(([data, pending]) => {
                if (cancelled) {
                    return;
                }
                setDevices(data);
                setPairingRequests(pending as DeviceConfig[]);
                setLoading(false);
            });
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [isConnected, isAdmin]);

    const handleDeleteClick = (deviceId: string, deviceName: string) => {
        setModalConfig({ isOpen: true, deviceId, deviceName });
    };

    const handleConfirmDelete = async () => {
        const { deviceId, deviceName } = modalConfig;
        setModalConfig(prev => ({ ...prev, isOpen: false }));
        
        setIsDeleting(deviceId);
        const success = await deleteDevice(deviceId);

        if (success) {
            setDevices((previous) => previous.filter((device) => device.device_id !== deviceId));
            showToast(`"${deviceName}" unpaired successfully.`, "success");
        } else {
            showToast(`Failed to unpair "${deviceName}". You might not have permission.`, "error");
        }
        setIsDeleting(null);
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background-light font-sans text-slate-800 transition-colors duration-300 selection:bg-primary selection:text-white dark:bg-background-dark dark:text-slate-200">
            <ConfirmModal
                isOpen={modalConfig.isOpen}
                title="Unpair Device?"
                message={`Are you sure you want to unpair "${modalConfig.deviceName}" from the dashboard? You can pair it again later from Discovery.`}
                confirmText="Unpair Device"
                onConfirm={handleConfirmDelete}
                onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                type="danger"
            />

            <Sidebar />

            <main className="relative flex min-w-0 flex-1 flex-col">
                <header className="z-30 flex min-h-16 flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-slate-200 bg-surface-light px-6 py-4 shadow-sm dark:border-slate-700 dark:bg-surface-dark lg:items-center">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-lg font-semibold text-slate-800 dark:text-white">
                            {isAdmin ? "Device Management" : "Device Availability"}
                        </h1>
                        <p className="max-w-2xl text-xs text-slate-500 dark:text-slate-400">
                            {isAdmin
                                ? "Pair, assign rooms, and manage the lifecycle of household devices."
                                : "Your account can only monitor whether assigned-room devices are online."}
                        </p>
                    </div>

                    <div className="flex w-full flex-wrap items-center justify-start gap-3 sm:w-auto sm:justify-end">
                        {isAdmin ? (
                            <>
                                <Link href="/devices/diy" className={primaryActionButtonClassName}>
                                    <span className="material-icons-round text-sm">hardware</span>
                                    <span>Create New Device</span>
                                </Link>
                                <Link href="/devices/discovery" className={`${secondaryActionButtonClassName} relative`}>
                                    <span className="material-icons-round text-sm">radar</span>
                                    <span>Scan Device</span>
                                    {pairingRequests.length > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white dark:border-slate-800"></span>
                                        </span>
                                    )}
                                </Link>
                            </>
                        ) : null}

                    </div>
                </header>

                <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6 dark:bg-background-dark">
                    <div className="mx-auto w-full max-w-7xl">
                        <div className="mb-6 flex flex-col items-start justify-between sm:flex-row sm:items-center">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                    {isAdmin ? "Your Ecosystem" : "Assigned Room Status"}
                                </h2>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    {isAdmin
                                        ? "Manage and configure all connected nodes within your network."
                                        : "Only online and offline status is visible on this page for non-admin accounts."}
                                </p>
                            </div>
                            <div className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-300 sm:mt-0">
                                Total: {loading ? "..." : devices.length} Devices
                            </div>
                        </div>

                        {!isAdmin ? (
                            <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                                Pairing, creating, deleting, and opening device configuration are disabled for non-admin accounts. Room control remains available from the dashboard for rooms assigned by an administrator.
                            </div>
                        ) : null}

                        {loading ? (
                            <div className="flex w-full justify-center py-20">
                                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
                            </div>
                        ) : devices.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-surface-light py-20 text-center shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-500/10">
                                    <span className="material-icons-round text-3xl text-primary">router</span>
                                </div>
                                <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">No devices found</h3>
                                <p className="mx-auto mb-6 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                                    {isAdmin
                                        ? "Start with the SVG builder for supported ESP32 or ESP8266 boards, or use discovery for already provisioned nodes."
                                        : "An administrator has not yet assigned any rooms with devices to your account."}
                                </p>
                                {isAdmin ? (
                                    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                                        <Link href="/devices/diy" className="flex min-w-44 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-600 hover:shadow-lg">
                                            <span className="material-icons-round mr-2 text-sm">hardware</span>
                                            Configure via SVG
                                        </Link>
                                        <Link href="/devices/discovery" className="relative flex min-w-44 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                                            <span className="material-icons-round mr-2 text-sm">radar</span>
                                            Scan Device
                                            {pairingRequests.length > 0 && (
                                                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white dark:border-slate-800"></span>
                                                </span>
                                            )}
                                        </Link>
                                    </div>
                                ) : null}
                            </div>
                        ) : isAdmin ? (
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                                {(devices as DeviceConfig[]).map((device) => {
                                    const isOnline = device.conn_status === "online";
                                    const activePins = getActivePinConfigurations(device);
                                    const modeColor = device.mode === "no-code"
                                        ? "border-purple-200 bg-purple-50 text-purple-500 dark:border-purple-500/20 dark:bg-purple-500/10"
                                        : "border-blue-200 bg-blue-50 text-blue-500 dark:border-blue-500/20 dark:bg-blue-500/10";
                                    const deviceIp = device.ip_address || device.last_state?.ip_address;
                                    const firmwareRevision = readTrimmedString(device.firmware_revision) || readTrimmedString(device.last_state?.firmware_revision);
                                    const firmwareVersion = readTrimmedString(device.firmware_version) || readTrimmedString(device.last_state?.firmware_version);

                                    return (
                                        <div key={device.device_id} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-surface-light transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-surface-dark">
                                            <div className="flex items-start justify-between border-b border-slate-100 p-5 dark:border-slate-700/50">
                                                <div className="flex w-full items-center gap-3">
                                                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isOnline ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
                                                        <span className="material-icons-round">{device.mode === "no-code" ? "extension" : "developer_board"}</span>
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h3 className="truncate font-semibold text-slate-900 dark:text-white" title={device.name}>{device.name}</h3>
                                                        <div className="mt-1 flex items-center">
                                                            <span className={`mr-1.5 h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-400"}`}></span>
                                                            <span className="truncate text-xs text-slate-500 dark:text-slate-400">{isOnline ? "Online" : "Offline"}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex-1 space-y-3 p-5 text-sm">
                                                <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">meeting_room</span> Room</span>
                                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{device.room_name || "Unassigned"}</span>
                                                </div>
                                                <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">fingerprint</span> MAC</span>
                                                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{device.mac_address || "N/A"}</span>
                                                </div>
                                                <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">settings_ethernet</span> Mode</span>
                                                    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${modeColor}`}>
                                                        {device.mode}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">sell</span> FW Revision</span>
                                                    <span
                                                        className="max-w-[10rem] truncate font-mono text-xs text-slate-700 dark:text-slate-300"
                                                        title={firmwareRevision || "Unknown"}
                                                    >
                                                        {firmwareRevision || "Unknown"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">tag</span> FW Version</span>
                                                    <span
                                                        className="max-w-[10rem] truncate font-mono text-xs text-slate-700 dark:text-slate-300"
                                                        title={firmwareVersion || "Unknown"}
                                                    >
                                                        {firmwareVersion || "Unknown"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">lan</span> IP</span>
                                                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{deviceIp || "N/A"}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">memory</span> Board Pins</span>
                                                    <span className="font-medium text-slate-700 dark:text-slate-300">{activePins.length} Maps</span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                                                {device.provisioning_project_id ? (
                                                    <Link
                                                        href={`/devices/${device.device_id}/config`}
                                                        className="flex items-center justify-center rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                                                    >
                                                        <span className="material-icons-round mr-1.5 text-sm text-blue-500">app_registration</span>
                                                        Configure
                                                    </Link>
                                                ) : (
                                                    <div className="flex items-center justify-center rounded border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed" title="Not a DIY configure device">
                                                        <span className="material-icons-round mr-1.5 text-sm text-slate-400">app_registration</span>
                                                        Configure
                                                    </div>
                                                )}

                                                <button
                                                    onClick={() => handleDeleteClick(device.device_id, device.name)}
                                                    disabled={isDeleting === device.device_id}
                                                    className="flex items-center justify-center rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-red-400 dark:hover:border-red-500/30 dark:hover:bg-red-500/10"
                                                >
                                                    {isDeleting === device.device_id ? (
                                                        <span className="material-icons-round animate-spin text-sm">refresh</span>
                                                    ) : (
                                                        <>
                                                            <span className="material-icons-round mr-1.5 text-sm">link_off</span>
                                                            Unpair
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                {devices.map((device) => {
                                    const isOnline = device.conn_status === "online";

                                    return (
                                        <div key={device.device_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{device.room_name || "Assigned room"}</h3>
                                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Availability only</p>
                                                </div>
                                                <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${isOnline ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300" : "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"}`}>
                                                    {isOnline ? "online" : "offline"}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
