/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { approveDiscoveredDevice, fetchDevices, rejectDiscoveredDevice } from "@/lib/api";
import { createRoom, fetchRooms, type RoomRecord } from "@/lib/rooms";
import { DeviceConfig } from "@/types/device";

type ScanState = "idle" | "scanning" | "found" | "connected";
type ConnectedSource = "auto" | "manual";

interface DeviceScanConnectPanelProps {
  onClose: () => void;
}

export default function DeviceScanConnectPanel({
  onClose,
}: DeviceScanConnectPanelProps) {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.account_type === "admin";

  const [scanState, setScanState] = useState<ScanState>("scanning");
  const [pendingDevices, setPendingDevices] = useState<DeviceConfig[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DeviceConfig | null>(null);
  const [connectedSource, setConnectedSource] = useState<ConnectedSource | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [actionError, setActionError] = useState("");
  const knownApprovedDeviceIdsRef = useRef<Set<string>>(new Set());
  const scanInitializedRef = useRef(false);

  async function refreshScanResults(options?: {
    resetKnownApproved?: boolean;
    keepScanningWhenEmpty?: boolean;
  }) {
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
      setConnectedDevice(null);
      setConnectedSource(null);
      setScanState("found");
      return "found" as const;
    }

    if (autoApprovedCandidate) {
      knownApprovedDeviceIdsRef.current.add(autoApprovedCandidate.device_id);
      setConnectedDevice(autoApprovedCandidate);
      setConnectedSource("auto");
      setScanState("connected");
      return "connected" as const;
    }

    setConnectedDevice(null);
    setConnectedSource(null);
    setScanState(options?.keepScanningWhenEmpty ? "scanning" : "idle");
    return "idle" as const;
  }

  function beginScan() {
    setActionError("");
    setRoomError("");
    setPendingDevices([]);
    setConnectedDevice(null);
    setConnectedSource(null);
    scanInitializedRef.current = false;
    setScanState("scanning");
  }

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
          setRoomError(error instanceof Error ? error.message : "Failed to load areas");
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
    if (!isAdmin || scanState !== "scanning") {
      return;
    }

    let cancelled = false;

    async function loadScanState() {
      try {
        const shouldResetKnownApproved = !scanInitializedRef.current;
        scanInitializedRef.current = true;
        await refreshScanResults({
          resetKnownApproved: shouldResetKnownApproved,
          keepScanningWhenEmpty: true,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to refresh scan results", error);
          setActionError("Live scan could not reach the current server.");
          setScanState("idle");
        }
      }
    }

    void loadScanState();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, scanState]);

  useWebSocket((event) => {
    if (!isAdmin) {
      return;
    }

    if (
      event.type === "pairing_requested" ||
      event.type === "pairing_queue_updated"
    ) {
      if (scanState === "scanning" || scanState === "found") {
        void refreshScanResults({ keepScanningWhenEmpty: scanState === "scanning" });
      }
      return;
    }

    if (
      (event.type === "device_online" || event.type === "device_state") &&
      scanState === "scanning"
    ) {
      void refreshScanResults({ keepScanningWhenEmpty: true });
    }
  });

  async function handleCreateRoom() {
    if (!newRoomName.trim()) {
      setRoomError("Enter an area name before creating it.");
      return;
    }

    setCreatingRoom(true);
    setRoomError("");

    try {
      const createdRoom = await createRoom({ name: newRoomName.trim() });
      setRooms((currentRooms) =>
        [...currentRooms, createdRoom].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setSelectedRoomId(createdRoom.room_id);
      setNewRoomName("");
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Failed to create area");
    } finally {
      setCreatingRoom(false);
    }
  }

  async function connectDevice(deviceId: string) {
    if (!selectedRoomId) {
      setRoomError("Select or create an area before connecting this device.");
      return;
    }

    setApproving(true);
    setActionError("");

    try {
      const success = await approveDiscoveredDevice(deviceId, selectedRoomId);
      if (!success) {
        setActionError("Failed to connect device.");
        return;
      }

      const pendingDevice = pendingDevices.find((device) => device.device_id === deviceId) ?? null;
      const selectedRoom = rooms.find((room) => room.room_id === selectedRoomId) ?? null;

      knownApprovedDeviceIdsRef.current.add(deviceId);
      setPendingDevices([]);
      setConnectedSource("manual");
      setConnectedDevice(
        pendingDevice
          ? {
              ...pendingDevice,
              auth_status: "approved",
              pairing_requested_at: null,
              room_name: selectedRoom?.name ?? pendingDevice.room_name ?? "Unassigned area",
            }
          : null,
      );
      setScanState("connected");
    } finally {
      setApproving(false);
    }
  }

  async function ignoreDevice(deviceId: string) {
    setRejecting(true);
    setActionError("");

    try {
      const success = await rejectDiscoveredDevice(deviceId);
      if (!success) {
        setActionError("Failed to ignore pairing.");
        return;
      }

      await refreshScanResults({ keepScanningWhenEmpty: true });
    } finally {
      setRejecting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="material-icons-round text-4xl">admin_panel_settings</span>
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Pairing and approving new devices is restricted to administrators.
        </p>
        <button
          onClick={onClose}
          className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
        >
          Close
        </button>
      </div>
    );
  }

  const activePendingDevice = pendingDevices[0] ?? null;
  const pendingDeviceIsUntrusted = Boolean(activePendingDevice && !activePendingDevice.provisioning_project_id);
  const connectedDeviceWasUntrusted = Boolean(
    connectedDevice &&
      connectedSource === "manual" &&
      !connectedDevice.provisioning_project_id,
  );
  const showLiveHint = scanState === "scanning" || scanState === "found";

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 pb-4 pt-6 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/50">
        <div>
          <h2 className="flex items-center text-lg font-bold text-slate-900 dark:text-white">
            {scanState === "scanning" ? (
              <>
                <span className="material-icons-round mr-2 animate-spin-slow text-blue-500">radar</span>
                Waiting For Pair Request
              </>
            ) : scanState === "found" ? (
              <>
                <span className="material-icons-round mr-2 text-green-500">link</span>
                Device Ready To Connect
              </>
            ) : scanState === "connected" ? (
              <>
                <span className="material-icons-round mr-2 text-emerald-500">devices</span>
                Device Connected
              </>
            ) : (
              <>
                <span className="material-icons-round mr-2 text-slate-400">search_off</span>
                Scanner Paused
              </>
            )}
          </h2>
          {showLiveHint ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              This window keeps listening on the current server over WebSocket until a board reports pairing.
            </p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
        >
          <span className="material-icons-round">close</span>
        </button>
      </div>

      <div className="p-6">
        {actionError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {actionError}
          </div>
        ) : null}

        {scanState === "scanning" ? (
          <div className="py-8 text-center">
            <div className="relative mx-auto mb-6 h-24 w-24">
              <div className="absolute inset-0 animate-ping rounded-full bg-blue-100 opacity-75 dark:bg-blue-900/40"></div>
              <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full border-4 border-blue-50 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <span className="material-icons-round animate-pulse text-4xl text-blue-500">wifi_tethering</span>
              </div>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-200">Listening for E-Connect boards...</h3>
            <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-slate-400">
              Keep the board powered and trigger pairing. As soon as it reaches this server, the connect card appears here without another rescan.
            </p>
          </div>
        ) : null}

        {scanState === "found" && activePendingDevice ? (
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
                Pair Request Received
              </div>
              <h3 className="mb-1 text-xl font-bold text-slate-900 dark:text-white">{activePendingDevice.name || "Unknown Device"}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">UUID: {activePendingDevice.device_id}</p>
            </div>

            <div className="mb-6 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700/50">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">MAC Address</span>
                <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{activePendingDevice.mac_address || "N/A"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Board Mode</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{activePendingDevice.mode || "LIBRARY"}</span>
              </div>
            </div>

            {pendingDeviceIsUntrusted ? (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                This board is requesting a manual pair without a trusted server-managed provisioning identity. You can still connect it, but verify the hardware and source before approving it onto the server.
              </div>
            ) : null}

            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
              <label
                htmlFor="scanner-room-select"
                className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
              >
                Assign Area
              </label>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Select where this board belongs, then connect it directly from this live scanner.
              </p>
              <select
                id="scanner-room-select"
                name="scanner-room-select"
                value={selectedRoomId ?? ""}
                onChange={(event) => setSelectedRoomId(event.target.value ? Number(event.target.value) : null)}
                className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                disabled={roomsLoading}
              >
                <option value="">{roomsLoading ? "Loading areas..." : "Select an area"}</option>
                {rooms.map((room) => (
                  <option key={room.room_id} value={room.room_id}>
                    {room.name}
                  </option>
                ))}
              </select>

              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                <label htmlFor="scanner-new-room-name" className="sr-only">
                  New area name
                </label>
                <input
                  id="scanner-new-room-name"
                  name="scanner-new-room-name"
                  type="text"
                  value={newRoomName}
                  onChange={(event) => setNewRoomName(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  placeholder="Create an area without leaving connect flow"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateRoom()}
                  disabled={creatingRoom || !newRoomName.trim()}
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingRoom ? "Creating..." : "Create area"}
                </button>
              </div>

              {roomError ? (
                <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{roomError}</p>
              ) : null}
            </div>

            <div className="space-y-3">
              <button
                onClick={() => void connectDevice(activePendingDevice.device_id)}
                disabled={approving || rejecting || !selectedRoomId}
                className="flex w-full items-center justify-center rounded-xl bg-green-600 px-4 py-3 font-medium text-white shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-icons-round mr-2">link</span>
                {approving ? "Connecting..." : pendingDeviceIsUntrusted ? "Connect With Warning" : "Connect"}
              </button>

              <button
                onClick={() => void ignoreDevice(activePendingDevice.device_id)}
                disabled={rejecting || approving}
                className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {rejecting ? "Ignoring..." : "Ignore"}
              </button>
            </div>
          </div>
        ) : null}

        {scanState === "connected" && connectedDevice ? (
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
                {connectedSource === "auto" ? "Auto-Approved Secure Board" : "Connected Successfully"}
              </div>
              <h3 className="mb-1 text-xl font-bold text-slate-900 dark:text-white">{connectedDevice.name || "Unknown Device"}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">UUID: {connectedDevice.device_id}</p>
            </div>

            <div className="mb-6 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700/50">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">MAC Address</span>
                <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{connectedDevice.mac_address || "N/A"}</span>
              </div>
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700/50">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Assigned Area</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{connectedDevice.room_name || "Unassigned area"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</span>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">Connected and managed</span>
              </div>
            </div>

            <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              {connectedSource === "auto"
                ? "This board was built by the server and its secure identity matched the provisioning project, so E-Connect approved it automatically."
                : "The pair request was approved from this live scanner, and the board is now managed in your device list."}
            </div>

            {connectedDeviceWasUntrusted ? (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                This board was paired through the untrusted/manual path. Review the hardware source and firmware before treating it like a server-trusted board replacement.
              </div>
            ) : null}

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
                Wait For Another Device
              </button>
            </div>
          </div>
        ) : null}

        {scanState === "idle" ? (
          <div className="py-8 text-center">
            <span className="material-icons-round mb-4 text-5xl text-slate-300 dark:text-slate-600">search_off</span>
            <h3 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-200">Scanner Stopped</h3>
            <p className="mx-auto mb-4 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Start live listening again when the board is ready to pair. The scanner only reflects pair requests that successfully reached this server.
            </p>
            <div className="mt-4 flex w-full flex-col gap-3">
              <button
                onClick={beginScan}
                className="flex w-full items-center justify-center rounded-lg bg-blue-100 px-6 py-3 font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-200"
              >
                <span className="material-icons-round mr-2">radar</span>
                Start Live Scan
              </button>
              <button
                onClick={() => router.push("/devices/diy")}
                className="flex w-full items-center justify-center rounded-lg bg-primary px-6 py-3 font-medium text-white shadow-sm transition-colors hover:bg-blue-600"
              >
                <span className="material-icons-round mr-2">memory</span>
                Create DIY Firmware
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-3 text-xs font-medium text-slate-400 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-500">
        <span className="flex items-center">
          <span className="material-icons-round mr-1.5 text-[14px] text-green-500">shield</span>
          Secure Local Provisioning
        </span>
        <span>WebSocket Live Scan</span>
      </div>
    </div>
  );
}
