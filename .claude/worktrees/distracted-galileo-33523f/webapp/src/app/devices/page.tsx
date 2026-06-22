/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageContext";
import Sidebar from "@/components/Sidebar";
import { fetchDevices, deleteDevice, fetchSystemStatus, SystemStatusResponse, updateDeviceVisibility } from "@/lib/api";
import { getActivePinConfigurations } from "@/lib/device-config";
import { formatDeviceTypeLabel, getDeviceType, getDeviceTypeIcon, isExternalDevice } from "@/lib/device-display";
import { DeviceConfig, DeviceDirectoryEntry } from "@/types/device";
import { useToast } from "@/components/ToastContext";
import ConfirmModal from "@/components/ConfirmModal";
import { useWebSocket } from "@/hooks/useWebSocket";
import DeviceScanConnectPanel from "@/components/DeviceScanConnectPanel";
import { fetchRooms, RoomRecord } from "@/lib/rooms";

import { rebuildFirmware, fetchDevice } from "@/lib/api";
import { OtaUpdateModal } from "@/components/OtaUpdateModal";
import { useOtaUpdate } from "@/hooks/useOtaUpdate";


function readTrimmedString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

type AreaFilterOption = { id: string; label: string };
const UNASSIGNED_AREA_ID = "unassigned";

function getAreaFilterOption(device: DeviceDirectoryEntry, t: (key: string) => string): AreaFilterOption {
    const trimmedRoomName = device.room_name?.trim();
    if (typeof device.room_id === "number") {
        return {
            id: `room:${device.room_id}`,
            label: trimmedRoomName && trimmedRoomName.length > 0 ? trimmedRoomName : `${t("devices.card.area")} ${device.room_id}`,
        };
    }

    const fallbackLabel = trimmedRoomName && trimmedRoomName.length > 0 ? trimmedRoomName : t("devices.unassigned");
    return {
        id: UNASSIGNED_AREA_ID,
        label: fallbackLabel,
    };
}

function getRoomAreaOption(room: RoomRecord, t: (key: string) => string): AreaFilterOption {
    const trimmedRoomName = room.name.trim();
    return {
        id: `room:${room.room_id}`,
        label: trimmedRoomName.length > 0 ? trimmedRoomName : `${t("devices.card.area")} ${room.room_id}`,
    };
}

export default function DevicesPage() {
    const { user } = useAuth();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const [devices, setDevices] = useState<DeviceDirectoryEntry[]>([]);
    const [rooms, setRooms] = useState<RoomRecord[]>([]);
    const [pairingRequests, setPairingRequests] = useState<DeviceConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [isTogglingVisibility, setIsTogglingVisibility] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");
    const [selectedArea, setSelectedArea] = useState("all");
    const [showAreaMenu, setShowAreaMenu] = useState(false);
    const [areaUnderlineStyle, setAreaUnderlineStyle] = useState({ x: 0, width: 0, opacity: 0 });
    const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        deviceId: string;
        deviceName: string;
        isExternal: boolean;
    }>({ isOpen: false, deviceId: "", deviceName: "", isExternal: false });
    const [passwordModal, setPasswordModal] = useState<{
        isOpen: boolean;
        deviceId: string | null;
        deviceName: string | null;
    }>({ isOpen: false, deviceId: null, deviceName: null });
    const [passwordInput, setPasswordInput] = useState("");
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [isRebuilding, setIsRebuilding] = useState(false);
    const [isScanModalOpen, setIsScanModalOpen] = useState(false);
    
    const isAdmin = user?.account_type === "admin";
    const primaryActionButtonClassName =
        "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-600 hover:shadow-lg";
    const secondaryActionButtonClassName =
        "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";

    
    const [latestFirmwareRevision, setLatestFirmwareRevision] = useState<string | null>(null);

    const [deviceForOta, setDeviceForOta] = useState<DeviceConfig | null>(null);
    const areaMenuRef = useRef<HTMLDivElement>(null);
    const areaTabsRowRef = useRef<HTMLDivElement>(null);
    const areaTabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const otaState = useOtaUpdate({
        device: deviceForOta,
        fetchDeviceFn: fetchDevice,
        onDeviceUpdated: (updated) => {
            if (updated) setDeviceForOta({ ...deviceForOta, ...updated });
        },
        onBuildJobUpdate: () => {}
    });

    const handleUpdateFirmwareClick = (deviceId: string, deviceName: string) => {
        setPasswordModal({ isOpen: true, deviceId, deviceName });
        setPasswordInput("");
        setPasswordError(null);
    };

    const confirmUpdateFirmware = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!passwordModal.deviceId) return;
        setIsRebuilding(true);
        setPasswordError(null);
        try {
            const devConfig = await fetchDevice(passwordModal.deviceId);
            if (!devConfig) throw new Error("Could not fetch device config");
            setDeviceForOta(devConfig);
            const res = await rebuildFirmware(passwordModal.deviceId, passwordInput);
            otaState.openPendingOtaModal(res.job_id);
            setPasswordModal({ isOpen: false, deviceId: null, deviceName: null });
        } catch (err: unknown) {
            setPasswordError(err instanceof Error ? err.message : "Failed to trigger update");
        } finally {
            setIsRebuilding(false);
        }
    };


    async function loadDevices() {
        const [data, pending, systemStatus, roomRecords] = await Promise.all([
            fetchDevices(),
            isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
            fetchSystemStatus().catch(() => null),
            fetchRooms().catch(() => [])
        ]);
        setDevices(data);
        setPairingRequests(pending as DeviceConfig[]);
        setRooms(roomRecords as RoomRecord[]);
        if (systemStatus) {
            setLatestFirmwareRevision(systemStatus.latest_firmware_revision || null);
        }
        setLoading(false);
    }



    useEffect(() => {
        let cancelled = false;

        void Promise.all([
            fetchDevices(),
            isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
            fetchSystemStatus().catch(() => null),
            fetchRooms().catch(() => [])
        ]).then(([data, pending, systemStatus, roomRecords]) => {
            if (cancelled) {
                return;
            }
            setDevices(data as DeviceDirectoryEntry[]);
            setPairingRequests(pending as DeviceConfig[]);
            setRooms(roomRecords as RoomRecord[]);
            if (systemStatus) {
                setLatestFirmwareRevision((systemStatus as SystemStatusResponse).latest_firmware_revision || null);
            }
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
                        const reportedAt = readTrimmedString(event.payload?.["reported_at"]);
                        return {
                            ...device,
                            conn_status: "online",
                            last_seen: reportedAt || ("last_seen" in device ? device.last_seen : undefined),
                        };
                    }
                    if (event.type === "device_offline") {
                        return { ...device, conn_status: "offline" };
                    }
                    if (event.type === "device_state") {
                        const reportedAt = readTrimmedString(event.payload?.["reported_at"]);
                        const reportedIp = readTrimmedString(event.payload?.["ip_address"]);
                        const reportedFirmwareRevision = readTrimmedString(event.payload?.["firmware_revision"]);
                        const reportedFirmwareVersion = readTrimmedString(event.payload?.["firmware_version"]);
                        const currentIpAddress = "ip_address" in device ? device.ip_address : undefined;
                        const currentFirmwareRevision = "firmware_revision" in device ? device.firmware_revision : undefined;
                        const currentFirmwareVersion = "firmware_version" in device ? device.firmware_version : undefined;

                        return {
                            ...device,
                            conn_status: "online",
                            last_seen: reportedAt || ("last_seen" in device ? device.last_seen : undefined),
                            last_state: (event.payload ?? null) as DeviceConfig["last_state"],
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
                isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
                fetchSystemStatus().catch(() => null),
                fetchRooms().catch(() => [])
            ]).then(([data, pending, systemStatus, roomRecords]) => {
                if (cancelled) {
                    return;
                }
                setDevices(data as DeviceDirectoryEntry[]);
                setPairingRequests(pending as DeviceConfig[]);
                setRooms(roomRecords as RoomRecord[]);
                if (systemStatus) {
                    setLatestFirmwareRevision(systemStatus.latest_firmware_revision || null);
                }
                setLoading(false);
            });
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [isConnected, isAdmin]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (areaMenuRef.current && !areaMenuRef.current.contains(event.target as Node)) {
                setShowAreaMenu(false);
            }
        };

        const handleResize = () => setWindowWidth(window.innerWidth);
        document.addEventListener("mousedown", handleClickOutside);
        window.addEventListener("resize", handleResize);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    const handleDeleteClick = (deviceId: string, deviceName: string, isExternal = false) => {
        setModalConfig({ isOpen: true, deviceId, deviceName, isExternal });
    };

    const handleToggleVisibility = async (deviceId: string, currentVisibility: boolean) => {
        if (isTogglingVisibility === deviceId) return;
        setIsTogglingVisibility(deviceId);
        try {
            const result = await updateDeviceVisibility(deviceId, !currentVisibility);
            if (result.status === "success") {
                setDevices((prev) => prev.map(d => d.device_id === deviceId ? { ...d, show_on_dashboard: result.show_on_dashboard } : d));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t("devices.toast.toggle_failed");
            showToast(message, "error");
        } finally {
            setIsTogglingVisibility(null);
        }
    };

    const handleConfirmDelete = async () => {
        const { deviceId, deviceName, isExternal } = modalConfig;
        setModalConfig(prev => ({ ...prev, isOpen: false }));
        
        setIsDeleting(deviceId);
        const success = await deleteDevice(deviceId);

        if (success) {
            setDevices((previous) => previous.filter((device) => device.device_id !== deviceId));
            showToast(
                isExternal
                    ? t("devices.toast.removed").replace("{name}", deviceName)
                    : t("devices.toast.unpaired").replace("{name}", deviceName),
                "success",
            );
        } else {
            showToast(
                isExternal
                    ? t("devices.toast.remove_failed").replace("{name}", deviceName)
                    : t("devices.toast.unpair_failed").replace("{name}", deviceName),
                "error",
            );
        }
        setIsDeleting(null);
    };

    const areaOptions = useMemo(() => {
        const seen = new Set<string>();
        const nextOptions: AreaFilterOption[] = [{ id: "all", label: t("devices.filter_all") }];

        rooms
            .map((room) => getRoomAreaOption(room, t))
            .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }))
            .forEach((option) => {
                if (!seen.has(option.id)) {
                    seen.add(option.id);
                    nextOptions.push(option);
                }
            });

        if (devices.some((device) => typeof device.room_id !== "number")) {
            nextOptions.push({ id: UNASSIGNED_AREA_ID, label: t("devices.unassigned") });
        }

        return nextOptions;
    }, [devices, rooms]);

    useEffect(() => {
        if (!areaOptions.some((option) => option.id === selectedArea)) {
            setSelectedArea("all");
        }
    }, [areaOptions, selectedArea]);

    const filteredDevices = useMemo(() => {
        if (selectedArea === "all") {
            return devices;
        }

        return devices.filter((device) => getAreaFilterOption(device, t).id === selectedArea);
    }, [devices, selectedArea, t]);

    const onlineDevices = filteredDevices.filter((d) => d.conn_status === "online");
    const offlineDevices = filteredDevices.filter((d) => d.conn_status !== "online");

    const selectedAreaLabel = useMemo(
        () => areaOptions.find((option) => option.id === selectedArea)?.label ?? t("devices.filter_all"),
        [areaOptions, selectedArea, t],
    );

    useEffect(() => {
        const syncAreaUnderline = () => {
            const currentTab = areaTabButtonRefs.current[selectedArea];
            if (!areaTabsRowRef.current || !currentTab) {
                setAreaUnderlineStyle((current) => ({ ...current, opacity: 0 }));
                return;
            }

            setAreaUnderlineStyle({
                x: currentTab.offsetLeft,
                width: currentTab.offsetWidth,
                opacity: 1,
            });
        };

        const frameId = window.requestAnimationFrame(syncAreaUnderline);
        return () => window.cancelAnimationFrame(frameId);
    }, [selectedArea, areaOptions, windowWidth]);

    const handleAreaSelection = useCallback((nextArea: string) => {
        setSelectedArea(nextArea);
        setShowAreaMenu(false);
    }, []);

    const renderAdminDeviceCard = (device: DeviceConfig) => {
        const isOnline = device.conn_status === "online";
        const isExternal = isExternalDevice(device);
        const activePins = getActivePinConfigurations(device);
        const deviceType = getDeviceType(device);
        const deviceTypeLabel = formatDeviceTypeLabel(deviceType);
        const deviceTypeIcon = getDeviceTypeIcon(deviceType);
        const deviceTypeColor = isExternal
            ? "border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300";
        const modeColor = device.mode === "no-code"
            ? "border-purple-200 bg-purple-50 text-purple-500 dark:border-purple-500/20 dark:bg-purple-500/10"
            : "border-blue-200 bg-blue-50 text-blue-500 dark:border-blue-500/20 dark:bg-blue-500/10";
        const deviceIp = device.ip_address || device.last_state?.ip_address;
        const firmwareRevision = readTrimmedString(device.firmware_revision) || readTrimmedString(device.last_state?.firmware_revision);
        const firmwareVersion = readTrimmedString(device.firmware_version) || readTrimmedString(device.last_state?.firmware_version);
        const configFieldCount = Object.keys(device.external_config ?? {}).length;

        return (
            <div key={device.device_id} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-surface-light transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-surface-dark">
                <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-700/50 gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className={`flex shrink-0 h-10 w-10 items-center justify-center rounded-lg ${isOnline ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
                            <span className="material-icons-round">{deviceTypeIcon}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="truncate font-semibold text-slate-900 dark:text-white" title={device.name}>{device.name}</h3>
                                {device.provisioning_project_id && latestFirmwareRevision && device.firmware_revision !== latestFirmwareRevision && (
                                    <button
                                        onClick={() => handleUpdateFirmwareClick(device.device_id, device.name)}
                                        className="inline-flex shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                                        title={`Update available: ${latestFirmwareRevision}`}
                                    >
                                        <span className="material-icons-round mr-1 text-[12px]">system_update_alt</span>
                                        {t("devices.card.update_fw")}
                                    </button>
                                )}
                            </div>
                            <div className="mt-1 flex items-center">
                                <span className={`mr-1.5 h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-400"}`}></span>
                                <span className="truncate text-xs text-slate-500 dark:text-slate-400">{isOnline ? t("devices.card.online") : t("devices.card.offline")}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        title={t("devices.card.show_on_dashboard")}
                        onClick={() => handleToggleVisibility(device.device_id, device.show_on_dashboard ?? true)}
                        disabled={isTogglingVisibility === device.device_id}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${device.show_on_dashboard !== false ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'} ${isTogglingVisibility === device.device_id ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${device.show_on_dashboard !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                </div>

                <div className="flex-1 space-y-3 p-5 text-sm">
                    <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                        <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">meeting_room</span> {t("devices.card.area")}</span>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{device.room_name || t("devices.card.unassigned_area")}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                        <span className="text-slate-500 dark:text-slate-400">
                            <span className="material-icons-round mr-1 align-text-bottom text-xs">{isExternal ? "extension" : "fingerprint"}</span>
                            {isExternal ? ` ${t("devices.card.source")}` : ` ${t("devices.card.mac")}`}
                        </span>
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                            {isExternal ? device.provider || device.extension_name || "N/A" : device.mac_address || "N/A"}
                        </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                        <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round mr-1 align-text-bottom text-xs">category</span> {t("devices.card.device_type")}</span>
                        <div className="flex items-center gap-2">
                            {device.board && !isExternal && (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400" title={t("devices.card.board_pins")}>
                                    {device.board}
                                </span>
                            )}
                            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${deviceTypeColor}`}>
                                {deviceTypeLabel}
                            </span>
                            {!isExternal ? (
                                <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${modeColor}`}>
                                    {device.mode}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    {!isExternal && (
                        <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                            <span className={`${latestFirmwareRevision && firmwareRevision && latestFirmwareRevision !== firmwareRevision ? "text-green-600 dark:text-green-400 font-medium" : "text-slate-500 dark:text-slate-400"}`}><span className="material-icons-round mr-1 align-text-bottom text-xs">sell</span> {t("devices.card.fw_revision")}</span>
                            <div className="flex items-center gap-1.5">
                                <span
                                    className="max-w-[8rem] truncate font-mono text-xs text-slate-700 dark:text-slate-300"
                                    title={firmwareRevision || t("devices.card.unknown")}
                                >
                                    {firmwareRevision || t("devices.card.unknown")}
                                </span>
                                {latestFirmwareRevision && firmwareRevision && latestFirmwareRevision !== firmwareRevision && (
                                    <>
                                        <span className="material-icons-round text-[10px] text-green-500 block -mt-[1px]">arrow_forward</span>
                                        <span className="font-mono text-xs font-semibold text-green-600 dark:text-green-400" title={`New firmware (${latestFirmwareRevision}) available to build.`}>
                                            {latestFirmwareRevision}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center">
                            <span className="material-icons-round mr-1 text-xs">{isExternal ? "sell" : "tag"}</span>
                            {isExternal ? t("devices.card.extension_version") : t("devices.card.fw_version")}
                        </span>
                        <span
                            className="max-w-[10rem] truncate font-mono text-xs text-slate-700 dark:text-slate-300 text-right"
                            title={isExternal ? device.firmware_version || t("devices.card.unknown") : firmwareVersion || t("devices.card.unknown")}
                        >
                            {isExternal ? device.firmware_version || t("devices.card.unknown") : firmwareVersion || t("devices.card.unknown")}
                        </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2 dark:border-slate-700/50">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center">
                            <span className="material-icons-round mr-1 text-xs">{isExternal ? "data_object" : "lan"}</span>
                            {isExternal ? t("devices.card.schema") : t("devices.card.ip")}
                        </span>
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-300 max-w-[10rem] truncate text-right" title={isExternal ? device.device_schema_id || "N/A" : deviceIp || "N/A"}>
                            {isExternal ? device.device_schema_id || "N/A" : deviceIp || "N/A"}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400">
                            <span className="material-icons-round mr-1 align-text-bottom text-xs">{isExternal ? "tune" : "memory"}</span>
                            {isExternal ? ` ${t("devices.card.config_fields")}` : ` ${t("devices.card.board_pins")}`}
                        </span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                            {isExternal ? `${configFieldCount} ${t("devices.card.values")}` : `${activePins.length} ${t("devices.card.maps")}`}
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                    {device.provisioning_project_id && !isExternal ? (
                        <Link
                            href={`/devices/${device.device_id}/config`}
                            className="flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                        >
                            <span className="material-icons-round mr-1.5 text-sm text-blue-500">app_registration</span>
                            {t("devices.card.configure")}
                        </Link>
                    ) : (
                        <div
                            className="flex cursor-not-allowed items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                            title={isExternal ? t("devices.card.managed_in_extensions") : t("devices.card.not_diy")}
                        >
                            <span className="material-icons-round mr-1.5 text-sm text-slate-400">app_registration</span>
                            {isExternal ? t("devices.card.managed_in_extensions") : t("devices.card.configure")}
                        </div>
                    )}

                    <button
                        onClick={() => handleDeleteClick(device.device_id, device.name, isExternal)}
                        disabled={isDeleting === device.device_id}
                        className="flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-red-400 dark:hover:border-red-500/30 dark:hover:bg-red-500/10"
                    >
                        {isDeleting === device.device_id ? (
                            <span className="material-icons-round animate-spin text-sm">refresh</span>
                        ) : (
                            <>
                                <span className="material-icons-round mr-1.5 text-sm">link_off</span>
                                {isExternal ? t("devices.card.remove") : t("devices.card.unpair")}
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    const renderNonAdminDeviceCard = (device: DeviceDirectoryEntry) => {
        const isOnline = device.conn_status === "online";

        return (
            <div key={device.device_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{device.room_name || t("devices.card_user.assigned_area")}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("devices.card_user.availability_only")}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${isOnline ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300" : "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"}`}>
                        {isOnline ? t("devices.card.online") : t("devices.card.offline")}
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background-light font-sans text-slate-800 transition-colors duration-300 selection:bg-primary selection:text-white dark:bg-background-dark dark:text-slate-200">
            {isAdmin && isScanModalOpen ? (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setIsScanModalOpen(false)} />
                    <div className="relative z-10 w-full max-w-xl">
                        <DeviceScanConnectPanel onClose={() => setIsScanModalOpen(false)} />
                    </div>
                </div>
            ) : null}

            <ConfirmModal
                isOpen={modalConfig.isOpen}
                title={modalConfig.isExternal ? t("devices.modal.remove_external_title") : t("devices.modal.unpair_title")}
                message={modalConfig.isExternal
                    ? t("devices.modal.remove_external_desc").replace("{name}", modalConfig.deviceName)
                    : t("devices.modal.unpair_desc").replace("{name}", modalConfig.deviceName)}
                confirmText={modalConfig.isExternal ? t("devices.modal.btn_remove") : t("devices.modal.btn_unpair")}
                onConfirm={handleConfirmDelete}
                onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                type="danger"
            />

            
            {deviceForOta && otaState.otaModalOpen && (
                <OtaUpdateModal
                    device={deviceForOta}
                    otaState={otaState}
                    onClose={() => {
                        otaState.setOtaModalOpen(false);
                        setDeviceForOta(null);
                    }}
                />
            )}

            {passwordModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity dark:bg-slate-950/60" onClick={() => !isRebuilding && setPasswordModal({ isOpen: false, deviceId: null, deviceName: null })}></div>
                    <form onSubmit={confirmUpdateFirmware} className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white p-6 shadow-2xl transition-all dark:bg-slate-900 sm:p-8">
                        <div>
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                            <span className="material-icons-round text-xl text-blue-600 dark:text-blue-400">lock</span>
                        </div>
                        <div className="mt-5 sm:mt-6">
                            <h3 className="text-center text-lg font-bold text-slate-900 dark:text-white">{t("devices.update_modal.title")}</h3>
                            <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                                {t("devices.update_modal.desc").replace("{name}", passwordModal.deviceName || "")}
                            </p>
                        </div>
                        </div>

                        {passwordError && (
                            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                            {passwordError}
                            </div>
                        )}

                        <label className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-200">
                            {t("devices.update_modal.password_label")}
                            <input
                                autoComplete="current-password"
                                autoFocus
                                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                id="update-firmware-password"
                                name="update-firmware-password"
                                onChange={(event) => {
                                    setPasswordInput(event.target.value);
                                    if (passwordError) setPasswordError(null);
                                }}
                                placeholder={t("devices.update_modal.password_placeholder")}
                                type="password"
                                value={passwordInput}
                            />
                        </label>

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                                disabled={isRebuilding}
                                onClick={() => setPasswordModal({ isOpen: false, deviceId: null, deviceName: null })}
                                type="button"
                            >
                                {t("devices.update_modal.btn_cancel")}
                            </button>
                            <button
                                className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={isRebuilding || passwordInput.trim().length < 8}
                                type="submit"
                            >
                                {isRebuilding ? <span className="material-icons-round animate-spin text-sm mr-2">refresh</span> : null}
                                {isRebuilding ? t("devices.update_modal.btn_updating") : t("devices.update_modal.btn_confirm")}
                            </button>
                        </div>
                    </form>
                </div>
            )}
            <Sidebar />


            <main className="relative flex min-w-0 flex-1 flex-col">
                <header className="z-30 flex h-16 shrink-0 items-center justify-between gap-x-4 border-b border-slate-200 bg-surface-light px-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-lg font-semibold leading-tight text-slate-800 dark:text-white">
                            {isAdmin ? t("devices.title_admin") : t("devices.title_user")}
                        </h1>
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            {isAdmin
                                ? t("devices.desc_admin")
                                : t("devices.desc_user")}
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-3">
                        {isAdmin ? (
                            <>
                                <Link href="/devices/diy" className={`${primaryActionButtonClassName} !min-h-9 !py-1.5`}>
                                    <span className="material-icons-round text-sm">hardware</span>
                                    <span className="hidden sm:inline">{t("devices.btn_create_new")}</span>
                                    <span className="sm:hidden">{t("devices.btn_create")}</span>
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => setIsScanModalOpen(true)}
                                    className={`${secondaryActionButtonClassName} !min-h-9 !py-1.5 relative`}
                                >
                                    <span className="material-icons-round text-sm">wifi_tethering</span>
                                    <span className="hidden sm:inline">{t("devices.btn_scan_device")}</span>
                                    <span className="sm:hidden">{t("devices.btn_scan")}</span>
                                    {pairingRequests.length > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                                            <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-red-500 dark:border-slate-800"></span>
                                        </span>
                                    )}
                                </button>
                            </>
                        ) : null}
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6 dark:bg-background-dark">
                    <div className="mx-auto w-full max-w-7xl">
                        <div className="mb-6 flex flex-col items-start justify-between sm:flex-row sm:items-center">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                    {isAdmin ? t("devices.subtitle_admin") : t("devices.subtitle_user")}
                                </h2>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    {isAdmin
                                        ? t("devices.subdesc_admin")
                                        : t("devices.subdesc_user")}
                                </p>
                            </div>
                            <div className="mt-4 flex flex-col items-end gap-3 sm:mt-0">
                                <div className="hidden sm:flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
                                    <button 
                                        onClick={() => setFilterStatus("all")}
                                        className={`px-3 py-1 text-sm font-medium rounded-md transition-colors leading-none ${filterStatus === "all" ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                                    >
                                        {t("devices.filter_all")}
                                    </button>
                                    <button 
                                        onClick={() => setFilterStatus("online")}
                                        className={`px-3 py-1 text-sm font-medium rounded-md transition-colors leading-none ${filterStatus === "online" ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                                    >
                                        {t("devices.filter_online")}
                                    </button>
                                    <button 
                                        onClick={() => setFilterStatus("offline")}
                                        className={`px-3 py-1 text-sm font-medium rounded-md transition-colors leading-none ${filterStatus === "offline" ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                                    >
                                        {t("devices.filter_offline")}
                                    </button>
                                </div>
                                <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                    {t("devices.total_devices").replace("{count}", loading ? "..." : filteredDevices.length.toString())}
                                </div>
                            </div>
                        </div>
                        <div
                            className="mb-6 flex items-end gap-4 border-b border-slate-200/80 pb-0 dark:border-slate-700/70"
                            ref={areaMenuRef}
                        >
                            <div className="relative min-w-0 flex-1">
                                <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                <div ref={areaTabsRowRef} className="relative flex min-w-max items-end gap-7 pr-10">
                                    {areaOptions.map((option) => {
                                        const isSelected = option.id === selectedArea;
                                        return (
                                            <button
                                                key={option.id}
                                                ref={(node) => {
                                                    areaTabButtonRefs.current[option.id] = node;
                                                }}
                                                type="button"
                                                onClick={() => handleAreaSelection(option.id)}
                                                className={`relative shrink-0 pb-3 text-[15px] font-medium transition-colors sm:text-base ${
                                                    isSelected
                                                        ? "text-slate-900 dark:text-white"
                                                        : "text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                                }`}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                    <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-slate-900 transition-[transform,width,opacity] duration-300 ease-out dark:bg-white"
                                        style={{
                                            width: `${areaUnderlineStyle.width}px`,
                                            opacity: areaUnderlineStyle.opacity,
                                            transform: `translateX(${areaUnderlineStyle.x}px)`,
                                        }}
                                    />
                                </div>
                                </div>
                                <div
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background-light via-background-light/95 to-transparent dark:from-background-dark dark:via-background-dark/95"
                                />
                            </div>
                            <div className="relative shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowAreaMenu((current) => !current)}
                                    className={`flex h-10 w-10 items-center justify-center pb-2 transition-colors ${
                                        showAreaMenu
                                            ? "text-slate-900 dark:text-white"
                                            : "text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                    }`}
                                    aria-label="Open areas list menu"
                                    aria-expanded={showAreaMenu}
                                >
                                    <span className="material-icons-round text-[20px]">menu</span>
                                </button>
                                {showAreaMenu ? (
                                    <div className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                        <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                                            {t("devices.areas_list")}
                                        </div>
                                        <div className="max-h-80 overflow-y-auto p-2">
                                            {areaOptions.map((option) => {
                                                const isSelected = option.id === selectedArea;
                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        onClick={() => handleAreaSelection(option.id)}
                                                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                                                            isSelected
                                                                ? "bg-primary/10 text-primary dark:bg-primary/15"
                                                                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                                                        }`}
                                                    >
                                                        <span>{option.label}</span>
                                                        {isSelected ? <span className="material-icons-round text-[18px]">check</span> : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        <div className="sm:hidden flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1 mb-6">
                            <button 
                                onClick={() => setFilterStatus("all")}
                                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors leading-none ${filterStatus === "all" ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                            >
                                {t("devices.filter_all")}
                            </button>
                            <button 
                                onClick={() => setFilterStatus("online")}
                                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors leading-none ${filterStatus === "online" ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                            >
                                {t("devices.filter_online")}
                            </button>
                            <button 
                                onClick={() => setFilterStatus("offline")}
                                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors leading-none ${filterStatus === "offline" ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                            >
                                {t("devices.filter_offline")}
                            </button>
                        </div>

                        {!isAdmin ? (
                            <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                                {t("devices.non_admin_warning")}
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
                                <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">{t("devices.no_devices_found")}</h3>
                                <p className="mx-auto mb-6 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                                    {isAdmin
                                        ? t("devices.no_devices_admin_desc")
                                        : t("devices.no_devices_user_desc")}
                                </p>
                                {isAdmin ? (
                                    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                                        <Link href="/devices/diy" className="flex min-w-44 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:bg-blue-600 hover:shadow-lg">
                                            <span className="material-icons-round mr-2 text-sm">hardware</span>
                                            {t("devices.btn_configure_svg")}
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => setIsScanModalOpen(true)}
                                            className="relative flex min-w-44 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                        >
                                            <span className="material-icons-round mr-2 text-sm">wifi_tethering</span>
                                            {t("devices.btn_scan_device")}
                                            {pairingRequests.length > 0 && (
                                                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white dark:border-slate-800"></span>
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : filteredDevices.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-surface-light py-20 text-center shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                                    <span className="material-icons-round text-3xl text-slate-400">meeting_room</span>
                                </div>
                                <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">{t("devices.no_devices_in_area")}</h3>
                                <p className="mx-auto max-w-sm text-sm text-slate-500 dark:text-slate-400">
                                    {selectedArea === "all" ? t("devices.no_devices_found_dot") : t("devices.no_devices_found_in").replace("{area}", selectedAreaLabel)}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                {/* Online Devices Section */}
                                {(filterStatus === "all" || filterStatus === "online") && onlineDevices.length > 0 && (
                                    <div>
                                        <h3 className="mb-4 flex items-center text-sm font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
                                            <span className="mr-2 h-2 w-2 rounded-full bg-green-500 shadow-sm"></span>
                                            {t("devices.online_devices").replace("{count}", onlineDevices.length.toString())}
                                        </h3>
                                        {isAdmin ? (
                                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                                                {(onlineDevices as DeviceConfig[]).map(renderAdminDeviceCard)}
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                {onlineDevices.map(renderNonAdminDeviceCard)}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Offline Devices Section */}
                                {(filterStatus === "all" || filterStatus === "offline") && offlineDevices.length > 0 && (
                                    <div>
                                        <h3 className="mb-4 flex items-center text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                            <span className="mr-2 h-2 w-2 rounded-full bg-slate-400 shadow-sm"></span>
                                            {t("devices.offline_devices").replace("{count}", offlineDevices.length.toString())}
                                        </h3>
                                        <div className="opacity-75">
                                            {isAdmin ? (
                                                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                                                    {(offlineDevices as DeviceConfig[]).map(renderAdminDeviceCard)}
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                    {offlineDevices.map(renderNonAdminDeviceCard)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {filterStatus === "online" && onlineDevices.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400 dark:border-slate-700">{t("devices.no_online_found")}</div>
                                )}
                                {filterStatus === "offline" && offlineDevices.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400 dark:border-slate-700">{t("devices.no_offline_found")}</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
