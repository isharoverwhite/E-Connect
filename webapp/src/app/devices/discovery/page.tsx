"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { approveDiscoveredDevice, fetchDevices, rejectDiscoveredDevice } from "@/lib/api";
import { createRoom, fetchRooms, type RoomRecord } from "@/lib/rooms";
import { DeviceConfig } from "@/types/device";

const SCAN_IDLE_DELAY_MS = 150000;

export default function DeviceDiscovery() {
    const [scanState, setScanState] = useState<"idle" | "scanning" | "found" | "connected">("scanning");
    const [pendingDevices, setPendingDevices] = useState<DeviceConfig[]>([]);
    const [autoApprovedDevice, setAutoApprovedDevice] = useState<DeviceConfig | null>(null);
    const [approving, setApproving] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [rooms, setRooms] = useState<RoomRecord[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(true);
    const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
    const [newRoomName, setNewRoomName] = useState("");
    const [creatingRoom, setCreatingRoom] = useState(false);
    const [roomError, setRoomError] = useState("");
    const router = useRouter();
    const { user } = useAuth();
    const isAdmin = user?.account_type === "admin";
    const knownApprovedDeviceIdsRef = useRef<Set<string>>(new Set());
    const scanInitializedRef = useRef(false);

    const refreshScanResults = async (options?: { resetKnownApproved?: boolean; keepScanningWhenEmpty?: boolean }) => {
        const [pending, approved] = await Promise.all([
            fetchDevices({ authStatus: "pending" }) as Promise<DeviceConfig[]>,
            fetchDevices() as Promise<DeviceConfig[]>,
        ]);

        const approvedDevices = approved.filter(
            (device): device is DeviceConfig => "mac_address" in device,
        );

        if (options?.resetKnownApproved) {
            knownApprovedDeviceIdsRef.current = new Set(
                approvedDevices.map((device) => device.device_id),
            );
        }

        const autoApprovedCandidate =
            approvedDevices
                .filter(
                    (device) =>
                        Boolean(device.provisioning_project_id) &&
                        device.auth_status === "approved" &&
                        !knownApprovedDeviceIdsRef.current.has(device.device_id),
                )
                .sort((left, right) => {
                    const leftSeen = left.last_seen ? Date.parse(left.last_seen) : 0;
                    const rightSeen = right.last_seen ? Date.parse(right.last_seen) : 0;
                    return rightSeen - leftSeen;
                })[0] ?? null;

        setPendingDevices(pending);

        if (pending.length > 0) {
            setAutoApprovedDevice(null);
            setScanState("found");
            return "found";
        }

        if (autoApprovedCandidate) {
            setAutoApprovedDevice(autoApprovedCandidate);
            setScanState("connected");
            return "connected";
        }

        setAutoApprovedDevice(null);
        setScanState(options?.keepScanningWhenEmpty ? "scanning" : "idle");
        return "idle";
    };

    const beginScan = () => {
        setPendingDevices([]);
        setAutoApprovedDevice(null);
        scanInitializedRef.current = false;
        setScanState("scanning");
    };

    useEffect(() => {
        if (!isAdmin) {
            setRoomsLoading(false);
            return;
        }

        let cancelled = false;

        async function loadRooms() {
            setRoomsLoading(true);
            setRoomError("");

            try {
                const nextRooms = await fetchRooms();
                if (cancelled) {
                    return;
                }
                setRooms(nextRooms);
                setSelectedRoomId((currentRoomId) => {
                    if (currentRoomId && nextRooms.some((room) => room.room_id === currentRoomId)) {
                        return currentRoomId;
                    }
                    return nextRooms[0]?.room_id ?? null;
                });
            } catch (error) {
                if (!cancelled) {
                    setRoomError(error instanceof Error ? error.message : "Failed to load rooms");
                }
            } finally {
                if (!cancelled) {
                    setRoomsLoading(false);
                }
            }
        }

        void loadRooms();
        return () => {
            cancelled = true;
        };
    }, [isAdmin]);

    useEffect(() => {
        if (!isAdmin) {
            return;
        }

        let cancelled = false;

        async function scanDevices() {
            try {
                if (cancelled) {
                    return;
                }

                if (scanState === "scanning") {
                    const shouldResetKnownApproved = !scanInitializedRef.current;
                    scanInitializedRef.current = true;
                    const result = await refreshScanResults({
                        resetKnownApproved: shouldResetKnownApproved,
                        keepScanningWhenEmpty: true,
                    });
                    if (!cancelled && result === "idle") {
                        window.setTimeout(() => {
                            if (!cancelled) {
                                void refreshScanResults();
                            }
                        }, SCAN_IDLE_DELAY_MS);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch devices", error);
                if (!cancelled) {
                    setScanState("idle");
                }
            }
        }

        void scanDevices();

        return () => {
            cancelled = true;
        };
    }, [isAdmin, scanState]);

    useWebSocket((event) => {
        if (
            !isAdmin ||
            scanState !== "scanning" ||
            (
                event.type !== "pairing_requested" &&
                event.type !== "pairing_queue_updated" &&
                event.type !== "device_state" &&
                event.type !== "device_online"
            )
        ) {
            return;
        }

        void refreshScanResults();
    });

    const handleCreateRoom = async () => {
        if (!newRoomName.trim()) {
            setRoomError("Enter a room name before creating it.");
            return;
        }

        setCreatingRoom(true);
        setRoomError("");

        try {
            const createdRoom = await createRoom({ name: newRoomName.trim() });
            setRooms((currentRooms) => [...currentRooms, createdRoom].sort((left, right) => left.name.localeCompare(right.name)));
            setSelectedRoomId(createdRoom.room_id);
            setNewRoomName("");
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : "Failed to create room");
        } finally {
            setCreatingRoom(false);
        }
    };

    const approveDevice = async (deviceId: string) => {
        if (!selectedRoomId) {
            setRoomError("Select or create a room before pairing this device.");
            return;
        }

        setApproving(true);
        try {
            const success = await approveDiscoveredDevice(deviceId, selectedRoomId);
            if (success) {
                router.push("/devices");
            } else {
                alert("Failed to approve device.");
            }
        } finally {
            setApproving(false);
        }
    };

    const rejectDevice = async (deviceId: string) => {
        setRejecting(true);
        try {
            const success = await rejectDiscoveredDevice(deviceId);
            if (success) {
                await refreshScanResults();
            } else {
                alert("Failed to ignore pairing.");
            }
        } finally {
            setRejecting(false);
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
                <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                        <span className="material-icons-round text-4xl">admin_panel_settings</span>
                    </div>
                    <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Pairing and approving new devices is restricted to administrators. Non-admin accounts can only monitor room availability and operate rooms already assigned to them.
                    </p>
                    <button
                        onClick={() => router.push("/devices")}
                        className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
                    >
                        Back to devices
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-slate-50 font-sans text-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <aside className="hidden w-20 flex-col items-center border-r border-slate-200 bg-white py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
                <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30">
                    <span className="material-icons-round text-2xl">hub</span>
                </div>
                <nav className="flex flex-col space-y-4">
                    <button onClick={() => router.push("/devices")} className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                        <span className="material-icons-round">arrow_back</span>
                    </button>
                    <button onClick={() => router.push("/settings")} className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200" title="Settings">
                        <span className="material-icons-round">settings</span>
                    </button>
                </nav>
            </aside>

            <main className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
                {scanState === "scanning" && (
                    <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-40 dark:opacity-20">
                        <div className="absolute h-[800px] w-[800px] animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full border border-blue-200 dark:border-blue-800/30"></div>
                        <div className="absolute h-[600px] w-[600px] animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_1s] rounded-full border border-blue-300 dark:border-blue-700/40"></div>
                        <div className="absolute h-[400px] w-[400px] animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_2s] rounded-full border border-blue-400 dark:border-blue-600/50"></div>
                    </div>
                )}

                <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 pb-4 pt-6 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/50">
                        <h2 className="flex items-center text-lg font-bold text-slate-900 dark:text-white">
                            {scanState === "scanning" ? (
                                <><span className="material-icons-round mr-2 animate-spin-slow text-blue-500">radar</span> Scanning Network</>
                            ) : scanState === "found" ? (
                                <><span className="material-icons-round mr-2 text-green-500">check_circle</span> Device Found</>
                            ) : scanState === "connected" ? (
                                <><span className="material-icons-round mr-2 text-emerald-500">devices</span> Device Connected</>
                            ) : (
                                <><span className="material-icons-round mr-2 text-slate-400">search_off</span> No Devices Ready</>
                            )}
                        </h2>
                        <button onClick={() => router.push("/devices")} className="text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300">
                            <span className="material-icons-round">close</span>
                        </button>
                    </div>

                    <div className="p-6">
                        {scanState === "scanning" ? (
                            <div className="py-8 text-center">
                                <div className="relative mx-auto mb-6 h-24 w-24">
                                    <div className="absolute inset-0 animate-ping rounded-full bg-blue-100 opacity-75 dark:bg-blue-900/40"></div>
                                    <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full border-4 border-blue-50 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                                        <span className="material-icons-round animate-pulse text-4xl text-blue-500">wifi_tethering</span>
                                    </div>
                                </div>
                                <h3 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-200">Looking for E-Connect devices...</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Ensure your new device is powered on and ready to pair.</p>
                                <div className="mt-8 flex justify-center">
                                    <button
                                        onClick={() => setScanState("idle")}
                                        className="rounded-lg border border-transparent px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:border-slate-200 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:text-slate-300"
                                    >
                                        Cancel Scan
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {scanState === "found" && pendingDevices.length > 0 ? (
                            <div className="animate-in slide-in-from-bottom-4 fade-in duration-500">
                                <div className="mb-6 flex justify-center">
                                    <div className="group relative">
                                        <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 opacity-25 blur transition duration-1000 group-hover:opacity-40 group-hover:duration-200"></div>
                                        <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full border-2 border-blue-100 bg-white shadow-md dark:border-slate-700 dark:bg-slate-800">
                                            <span className="material-icons-round text-4xl text-slate-700 dark:text-slate-300">developer_board</span>
                                            <span className="absolute bottom-2 right-2 h-4 w-4 rounded-full border-2 border-white bg-green-500 dark:border-slate-800"></span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-6 text-center">
                                    <div className="mb-3 inline-flex items-center rounded-full border border-blue-200/50 bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-400">
                                        Ready To Pair
                                    </div>
                                    <h3 className="mb-1 text-xl font-bold text-slate-900 dark:text-white">{pendingDevices[0].name || "Unknown Device"}</h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">UUID: {pendingDevices[0].device_id}</p>
                                </div>

                                <div className="mb-6 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
                                    <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700/50">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">MAC Address</span>
                                        <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{pendingDevices[0].mac_address || "N/A"}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Board Mode</span>
                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{pendingDevices[0].mode || "LIBRARY"}</span>
                                    </div>
                                </div>

                                <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
                                    <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                        Assign Room
                                    </label>
                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                        Pairing now requires selecting the room this device will belong to.
                                    </p>
                                    <select
                                        value={selectedRoomId ?? ""}
                                        onChange={(event) => setSelectedRoomId(event.target.value ? Number(event.target.value) : null)}
                                        className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                        disabled={roomsLoading}
                                    >
                                        <option value="">{roomsLoading ? "Loading rooms..." : "Select a room"}</option>
                                        {rooms.map((room) => (
                                            <option key={room.room_id} value={room.room_id}>
                                                {room.name}
                                            </option>
                                        ))}
                                    </select>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                                        <input
                                            type="text"
                                            value={newRoomName}
                                            onChange={(event) => setNewRoomName(event.target.value)}
                                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                            placeholder="Create a room without leaving pairing"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void handleCreateRoom()}
                                            disabled={creatingRoom || !newRoomName.trim()}
                                            className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {creatingRoom ? "Creating..." : "Create room"}
                                        </button>
                                    </div>

                                    {roomError ? (
                                        <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{roomError}</p>
                                    ) : null}
                                </div>

                                <div className="space-y-3">
                                    <button
                                        onClick={() => void approveDevice(pendingDevices[0].device_id)}
                                        disabled={approving || rejecting || !selectedRoomId}
                                        className="flex w-full items-center justify-center rounded-xl bg-green-600 px-4 py-3 font-medium text-white shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="material-icons-round mr-2">verified</span>
                                        {approving ? "Pairing..." : "Pair Device"}
                                    </button>

                                    <button
                                        onClick={() => void rejectDevice(pendingDevices[0].device_id)}
                                        disabled={rejecting || approving}
                                        className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                    >
                                        {rejecting ? "Ignoring..." : "Ignore"}
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {scanState === "connected" && autoApprovedDevice ? (
                            <div className="animate-in slide-in-from-bottom-4 fade-in duration-500">
                                <div className="mb-6 flex justify-center">
                                    <div className="group relative">
                                        <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 opacity-25 blur transition duration-1000 group-hover:opacity-40 group-hover:duration-200"></div>
                                        <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full border-2 border-emerald-100 bg-white shadow-md dark:border-slate-700 dark:bg-slate-800">
                                            <span className="material-icons-round text-4xl text-slate-700 dark:text-slate-300">memory</span>
                                            <span className="absolute bottom-2 right-2 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-800"></span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-6 text-center">
                                    <div className="mb-3 inline-flex items-center rounded-full border border-emerald-200/50 bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-300">
                                        Auto-Approved Secure Board
                                    </div>
                                    <h3 className="mb-1 text-xl font-bold text-slate-900 dark:text-white">{autoApprovedDevice.name || "Unknown Device"}</h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">UUID: {autoApprovedDevice.device_id}</p>
                                </div>

                                <div className="mb-6 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
                                    <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700/50">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">MAC Address</span>
                                        <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{autoApprovedDevice.mac_address || "N/A"}</span>
                                    </div>
                                    <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700/50">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Assigned Room</span>
                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{autoApprovedDevice.room_name || "Unassigned"}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</span>
                                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">Connected and managed</span>
                                    </div>
                                </div>

                                <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                                    This board was built by the server and its secure identity matched the provisioning project, so E-Connect approved it automatically and added it to your managed devices.
                                </div>

                                <div className="space-y-3">
                                    <button
                                        onClick={() => router.push("/devices")}
                                        className="flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow-[0_4px_14px_0_rgba(5,150,105,0.39)] transition-all hover:bg-emerald-700"
                                    >
                                        <span className="material-icons-round mr-2">dashboard</span>
                                        Open Device List
                                    </button>

                                    <button
                                        onClick={beginScan}
                                        className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                    >
                                        <span className="material-icons-round mr-2">radar</span>
                                        Scan Again
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {scanState === "idle" ? (
                            <div className="py-8 text-center">
                                <span className="material-icons-round mb-4 text-5xl text-slate-300 dark:text-slate-600">search_off</span>
                                <h3 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-200">No New Devices</h3>
                                <p className="mx-auto mb-4 max-w-md text-sm text-slate-500 dark:text-slate-400">
                                    Discovery only shows boards that successfully reached this server. If you moved the server to a new IP, rebuild and reflash the board so its embedded MQTT/server host matches the new machine.
                                </p>
                                <div className="mt-4 flex w-full flex-col gap-3">
                                    <button onClick={beginScan} className="flex w-full items-center justify-center rounded-lg bg-blue-100 px-6 py-3 font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-200">
                                        <span className="material-icons-round mr-2">search</span> Rescan Network
                                    </button>
                                    <button onClick={() => router.push("/devices/diy")} className="flex w-full items-center justify-center rounded-lg bg-primary px-6 py-3 font-medium text-white shadow-sm transition-colors hover:bg-blue-600">
                                        <span className="material-icons-round mr-2">memory</span> Create DIY Firmware
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-3 text-xs font-medium text-slate-400 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-500">
                        <span className="flex items-center"><span className="material-icons-round mr-1.5 text-[14px] text-green-500">shield</span> Secure Local Provisioning</span>
                        <span>mDNS Broadcast</span>
                    </div>
                </div>
            </main>
        </div>
    );
}
